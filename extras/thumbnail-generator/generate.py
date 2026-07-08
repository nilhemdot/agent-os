#!/usr/bin/env python3
"""
YouTube thumbnail generator using OpenAI gpt-image-2.

Generates 1280x720 YouTube thumbnails from text prompts, optionally
compositing in reference assets (logos, product shots, face photos).

Usage:
  # Pure text-to-image (one prompt per --prompt flag, or a JSON file)
  generate.py --prompt "..." --prompt "..." --out ./out --slug grok-cli

  # With reference images/logos (uses the /edits endpoint, input_fidelity=high)
  generate.py --prompt "..." --ref logo.png --ref face.jpg --out ./out --slug x

  # From a JSON job file: {"slug": "...", "prompts": ["...", "..."], "refs": ["..."]}
  generate.py --job job.json --out ./out

Output: <out>/<slug>-1.jpg ... resized/cropped to exactly 1280x720.
Reads OPENAI_API_KEY from env or from the skill's .env file.
"""
import argparse, base64, io, json, os, sys, time, urllib.request, urllib.error, mimetypes, uuid
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image

API_GEN = "https://api.openai.com/v1/images/generations"
API_EDIT = "https://api.openai.com/v1/images/edits"
MODEL = "gpt-image-2"
GEN_SIZE = "2048x1152"   # native 16:9. gpt-image-2 supports flexible custom sizes
GEN_RATIO = 2048 / 1152  # 1.778 — true 16:9, so NO crop/pad: just resize to output
THUMB = (1280, 720)


def pad_ref_to_gen_ratio(path):
    """Letterbox a wide reference (e.g. a 16:9 thumbnail) up to gpt-image-2's
    3:2 output ratio BEFORE sending it to /edits.

    gpt-image-2 can only render 3:2 (1536x1024). When it's handed a 16:9 (1.78)
    reference but must emit 3:2 (1.50), it fills its frame by height and SLICES
    THE LEFT/RIGHT EDGES off the design (the 'HE' of HERMES disappears). By
    pre-padding the ref with top/bottom bands first, the whole design — full
    width — sits centred inside a 3:2 canvas, so the model never has to crop the
    sides. The bands are a blurred, darkened copy of the image so the model
    treats them as ambient background, not as empty space to invent content in.

    Returns (path_to_use, was_padded). Refs that are already <= 3:2 are
    returned untouched.
    """
    try:
        from PIL import ImageFilter, ImageEnhance
        im = Image.open(path).convert("RGB")
    except Exception:
        return path, False
    if im.width / im.height <= GEN_RATIO + 0.01:
        return path, False  # square / portrait / 3:2 — no side loss possible
    target_h = round(im.width / GEN_RATIO)        # taller canvas, same width
    pad = target_h - im.height
    top = pad // 2
    canvas = Image.new("RGB", (im.width, target_h))
    # ambient background: the image blown up to cover, blurred + darkened
    bscale = target_h / im.height
    bg = im.resize((round(im.width * bscale), target_h), Image.LANCZOS)
    bl = (bg.width - im.width) // 2
    bg = bg.crop((bl, 0, bl + im.width, target_h))
    bg = ImageEnhance.Brightness(bg.filter(ImageFilter.GaussianBlur(40))).enhance(0.45)
    canvas.paste(bg, (0, 0))
    canvas.paste(im, (0, top))                    # full design, centred, untouched
    tmp = Path(path).with_name(f".padded-{uuid.uuid4().hex[:8]}.png")
    canvas.save(tmp, "PNG")
    return str(tmp), True


def load_key():
    key = os.environ.get("OPENAI_API_KEY")
    if key:
        return key
    env = Path(__file__).resolve().parent.parent / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line.startswith("OPENAI_API_KEY="):
                return line.split("=", 1)[1].strip()
    sys.exit("ERROR: OPENAI_API_KEY not found in env or skill .env")


def crop_to_thumb(png_bytes, mode="pad", size=THUMB, quality=92, fmt="jpeg"):
    """Convert a gpt-image-2 3:2 render to a 1280x720 (16:9) thumbnail.

    mode="pad" (default): fit the FULL image by height so NOTHING is ever
        clipped vertically — top AND bottom headlines are always preserved.
        gpt-image-2's 3:2 frame is narrower than 16:9, so the side gaps are
        filled with a blurred, darkened copy of the same image (a soft glow,
        not a flat margin) — clean, intentional-looking, never a black bar or
        a smeared edge-stretch.
    mode="cover": legacy center-crop fill (bleeds edge-to-edge but CLIPS the
        top or bottom). Avoid for designs with text near the top/bottom edge.
    """
    from PIL import Image, ImageFilter, ImageEnhance
    im = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    tw, th = size

    if mode == "preserve":
        # Pairs with pad_ref_to_gen_ratio: the ref was letterboxed to 3:2 before
        # the edit, so the design fills the FULL width and is vertically centred
        # in the 3:2 render. Scale to target width (never touches the sides) and
        # trim back to 16:9 biased HARD toward the BOTTOM — the model tends to sit
        # the title near the top, so a symmetric trim clipped it. ~12% off the top
        # keeps the headline's margin; the rest comes off the (text-free) bottom.
        scale = tw / im.width
        nw, nh = tw, round(im.height * scale)
        im = im.resize((nw, nh), Image.LANCZOS)
        top = int(max(0, nh - th) * 0.12)
        im = im.crop((0, top, tw, top + th))
    elif mode == "cover":
        scale = max(tw / im.width, th / im.height)
        nw, nh = round(im.width * scale), round(im.height * scale)
        im = im.resize((nw, nh), Image.LANCZOS)
        left = (nw - tw) // 2
        # bias the crop hard toward the BOTTOM (which is usually empty/background)
        # so the top headline is essentially never clipped — only ~12% off the top.
        top = int((nh - th) * 0.12)
        im = im.crop((left, top, left + tw, top + th))
    else:  # pad — guaranteed no vertical clipping
        scale = th / im.height
        nw, nh = round(im.width * scale), th
        im = im.resize((nw, nh), Image.LANCZOS)
        if nw >= tw:  # wide enough: center-crop width only (vertical untouched)
            left = (nw - tw) // 2
            im = im.crop((left, 0, left + tw, th))
        else:  # narrower than 16:9: fill the side gaps with a blurred copy
            # Background: the same image scaled to COVER the full 16:9 frame,
            # blurred + slightly dimmed so it reads as the design's own glow
            # extending to the edges (not a dark bar). Foreground: the full sharp
            # image centred on top. Nothing is ever cut; the seams melt into the blur.
            bscale = max(tw / im.width, th / im.height)
            bg = im.resize((round(im.width * bscale), round(im.height * bscale)), Image.LANCZOS)
            bl, bt = (bg.width - tw) // 2, (bg.height - th) // 2
            bg = bg.crop((bl, bt, bl + tw, bt + th))
            bg = bg.filter(ImageFilter.GaussianBlur(40))
            bg = ImageEnhance.Brightness(bg).enhance(0.62)
            off = (tw - nw) // 2
            bg.paste(im, (off, 0))
            im = bg

    out = io.BytesIO()
    if fmt == "png":
        im.save(out, "PNG")
    else:
        im.save(out, "JPEG", quality=quality)
    return out.getvalue()


def post_json(url, key, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    return _send(req)


def post_multipart(url, key, fields, files):
    boundary = "----thumb" + uuid.uuid4().hex
    body = io.BytesIO()

    def w(s):
        body.write(s.encode() if isinstance(s, str) else s)

    for name, val in fields:
        w(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{val}\r\n")
    for name, path in files:
        fn = os.path.basename(path)
        ctype = mimetypes.guess_type(path)[0] or "image/png"
        w(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{fn}\"\r\nContent-Type: {ctype}\r\n\r\n")
        w(Path(path).read_bytes())
        w("\r\n")
    w(f"--{boundary}--\r\n")
    req = urllib.request.Request(url, data=body.getvalue(), method="POST",
        headers={"Authorization": f"Bearer {key}",
                 "Content-Type": f"multipart/form-data; boundary={boundary}"})
    return _send(req)


def _send(req):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:500]
            if e.code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(2 ** attempt * 3)
                continue
            sys.exit(f"ERROR HTTP {e.code}: {msg}")
        except urllib.error.URLError as e:
            if attempt < 3:
                time.sleep(2 ** attempt * 3)
                continue
            sys.exit(f"ERROR: {e}")
    sys.exit("ERROR: exhausted retries")


def generate_one(key, prompt, refs, pad_refs=False):
    if refs:
        fields = [("model", MODEL), ("size", GEN_SIZE),
                  ("quality", "high"), ("n", "1")]
        fields.append(("prompt", prompt))
        send, temps = [], []
        for r in refs:
            if pad_refs:
                p, padded = pad_ref_to_gen_ratio(r)
                if padded:
                    temps.append(p)
                send.append(p)
            else:
                send.append(r)
        files = [("image[]", r) for r in send]
        try:
            resp = post_multipart(API_EDIT, key, fields, files)
        finally:
            for t in temps:
                try:
                    os.remove(t)
                except OSError:
                    pass
    else:
        resp = post_json(API_GEN, key, {
            "model": MODEL, "prompt": prompt, "size": GEN_SIZE,
            "quality": "high", "n": 1})
    b64 = resp["data"][0]["b64_json"]
    return base64.b64decode(b64)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", action="append", default=[])
    ap.add_argument("--ref", action="append", default=[])
    ap.add_argument("--job", help="JSON file with slug/prompts/refs")
    ap.add_argument("--out", default="./thumbnails_out")
    ap.add_argument("--slug", default="thumb")
    ap.add_argument("--fit", choices=["pad", "cover", "preserve"], default="cover",
                    help="cover (full-bleed center-crop), pad (blurred side margins), "
                         "or preserve (letterbox a 16:9 ref to 3:2 first so gpt-image-2 "
                         "can't crop the sides, then trim top/bottom back to 16:9 — best for full thumbnails)")
    ap.add_argument("--open", action="store_true", help="open results in Preview (macOS)")
    ap.add_argument("--out-size", default="1280x720", help="output WxH, e.g. 1920x1080 (default 1280x720)")
    ap.add_argument("--quality", type=int, default=92, help="JPEG save quality 1-100 (default 92)")
    ap.add_argument("--format", choices=["jpeg", "png"], default="jpeg", help="output format (default jpeg)")
    args = ap.parse_args()
    ext = "png" if args.format == "png" else "jpg"
    try:
        _w, _h = (int(x) for x in args.out_size.lower().split("x"))
        osize = (_w, _h)
    except Exception:
        osize = THUMB

    prompts, refs, slug = args.prompt, args.ref, args.slug
    headlines = []
    if args.job:
        job = json.loads(Path(args.job).read_text())
        prompts = job.get("prompts", prompts)
        refs = job.get("refs", refs)
        slug = job.get("slug", slug)
        # headline overlay: one spec per prompt ("headlines"), or one for all ("headline")
        headlines = job.get("headlines") or ([job["headline"]] * len(prompts)
                                             if job.get("headline") else [])
    if not prompts:
        sys.exit("ERROR: no prompts given")

    key = load_key()
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    results = []
    for i, p in enumerate(prompts, 1):
        sys.stderr.write(f"[{i}/{len(prompts)}] generating {slug}-{i} ...\n")
        sys.stderr.flush()
        raw = generate_one(key, p, refs, pad_refs=(args.fit in ("preserve", "pad")))
        jpg = crop_to_thumb(raw, mode=args.fit, size=osize, quality=args.quality, fmt=args.format)
        spec = headlines[i - 1] if i - 1 < len(headlines) else None
        if spec:
            from text_overlay import render_headline
            im = Image.open(io.BytesIO(jpg)).convert("RGB")
            im = render_headline(im, spec)
            buf = io.BytesIO()
            if args.format == "png":
                im.save(buf, "PNG")
            else:
                im.save(buf, "JPEG", quality=args.quality)
            jpg = buf.getvalue()
        dest = outdir / f"{slug}-{i}.{ext}"
        dest.write_bytes(jpg)
        results.append(str(dest))
        sys.stderr.write(f"      -> {dest}\n")
    if args.open and results:
        import subprocess
        try:
            subprocess.run(["open", *results], check=False)
        except Exception:
            pass
    print(json.dumps({"outputs": results}))


if __name__ == "__main__":
    main()
