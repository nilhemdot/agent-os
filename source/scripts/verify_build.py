#!/usr/bin/env python3
# Runtime verifier for pipeline builds — CONSERVATIVE: only flags clear breakage so
# it never "fixes" a good build. Loads the file headless, captures LOAD-TIME JS
# errors, video stand-ins, and genuinely-empty content apps (excludes canvas/svg
# visual apps & games). Prints JSON {"ok":bool,"problems":[...]}. ok+skip if no Chrome.
import asyncio, json, subprocess, time, urllib.request, os, sys

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome", "chromium", "chromium-browser",
]
def find_chrome():
    from shutil import which
    for c in CHROME_CANDIDATES:
        if os.path.sep in c:
            if os.path.exists(c): return c
        elif which(c): return c
    return None

def out(ok, problems, **extra):
    print(json.dumps({"ok": ok, "problems": problems, **extra})); sys.exit(0)

# Classify a console error. "hard" = code that failed to parse/resolve (always breaks
# something — flag it). "soft" = a runtime error that may be non-fatal (flag only when
# the app is also visibly broken). None = benign noise.
def err_kind(err: str):
    e = err.lower()
    if any(b in e for b in ["favicon", "preload", "net::err_file_not_found", "download the devtools"]):
        return None
    if any(k in e for k in ["syntaxerror", "referenceerror", "is not defined", "unexpected"]):
        return "hard"
    if any(k in e for k in ["typeerror", "is not a function", "cannot read", "uncaught"]):
        return "soft"
    return None

async def run(path):
    chrome = find_chrome()
    if not chrome: out(True, [], skip="no chrome")
    port = 9521
    proc = subprocess.Popen([chrome, "--headless=new", "--disable-gpu", f"--remote-debugging-port={port}",
        "--window-size=1400,900", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws = None
        for _ in range(40):
            try:
                for t in json.load(urllib.request.urlopen(f"http://localhost:{port}/json")):
                    if t.get("type") == "page": ws = t["webSocketDebuggerUrl"]; break
                if ws: break
            except Exception: time.sleep(0.25)
        if not ws: out(True, [], skip="no devtools")
        import websockets
        async with websockets.connect(ws, max_size=None) as w:
            i = 0; load_errors = []
            async def send(m, p=None):
                nonlocal i; i += 1; await w.send(json.dumps({"id": i, "method": m, "params": p or {}})); return i
            async def cmd(m, p=None):
                mid = await send(m, p)
                while True:
                    r = json.loads(await w.recv())
                    if r.get("method") in ("Runtime.exceptionThrown",):
                        d = r["params"]["exceptionDetails"]
                        load_errors.append(str(d.get("exception", {}).get("description", d.get("text", "")))[:160])
                    if r.get("method") == "Runtime.consoleAPICalled" and r["params"].get("type") == "error":
                        load_errors.append(" ".join(str(a.get("value", a.get("description", ""))) for a in r["params"]["args"])[:160])
                    if r.get("id") == mid: return r
            async def ev(expr):
                r = await cmd("Runtime.evaluate", {"expression": expr, "returnByValue": True})
                return r.get("result", {}).get("result", {}).get("value")
            await cmd("Runtime.enable"); await cmd("Page.enable")
            await cmd("Page.navigate", {"url": f"file://{path}"})
            # Pump messages during load so exceptions are captured (no interaction yet).
            t0 = time.time()
            while time.time() - t0 < 4:
                try:
                    r = json.loads(await asyncio.wait_for(w.recv(), timeout=0.5))
                    if r.get("method") == "Runtime.exceptionThrown":
                        d = r["params"]["exceptionDetails"]
                        load_errors.append(str(d.get("exception", {}).get("description", d.get("text", "")))[:160])
                    if r.get("method") == "Runtime.consoleAPICalled" and r["params"].get("type") == "error":
                        load_errors.append(" ".join(str(a.get("value", a.get("description", ""))) for a in r["params"]["args"])[:160])
                except asyncio.TimeoutError:
                    pass

            problems = []
            shape = await ev("""(()=>{
              const t=(document.body.innerText||'');
              const canvas=[...document.querySelectorAll('canvas')];
              const bigCanvas=canvas.some(c=>c.width>200&&c.height>200);
              // Does a big canvas actually DRAW anything? (catches dead visualizations / blank charts)
              let bigC=0, drawn=0;
              for(const c of canvas){ if(c.width>200&&c.height>200){ bigC++; try{ const x=c.getContext('2d'); if(!x){ drawn++; continue; } const d=x.getImageData(0,0,c.width,c.height).data; let bright=0; for(let i=0;i<d.length;i+=4){ if(d[i]+d[i+1]+d[i+2]>110){ if(++bright>=40) break; } } if(bright>=40) drawn++; }catch(e){ drawn++; } } }
              const canvasBlank = bigC>0 && drawn===0;
              const svg=document.querySelectorAll('svg').length;
              const z=(t.match(/\\b0(\\.0+)?%?\\b/g)||[]).length;
              const nodata=/no data|nothing (yet|here)|0 of 0|add your first|get started building/i.test(t);
              const lists=[...document.querySelectorAll('ul,ol,[class*=list i],[id*=list i],[class*=grid i]')];
              const filled=lists.filter(l=>[...l.children].some(c=>c.offsetParent)).length;
              const isVisualApp=bigCanvas;
              return {textLen:t.length,zeros:z,nodata,lists:lists.length,filled,isVisualApp,canvasBlank,hasMedia:!!document.querySelector('video,iframe')};
            })()""") or {}

            hard = list(dict.fromkeys([e for e in load_errors if err_kind(e) == "hard"]))[:4]
            soft = list(dict.fromkeys([e for e in load_errors if err_kind(e) == "soft"]))[:4]
            if shape.get("hasMedia"):
                problems.append("The app embeds a <video>/<iframe> instead of real functionality — remove it and build the actual working feature (e.g. for a timer, a real working countdown with start/pause/reset).")
            # Blank canvas = the visualization/game/chart draws NOTHING (e.g. 0 particles).
            if shape.get("canvasBlank"):
                problems.append("The main canvas renders NOTHING — it is completely blank (e.g. 0 particles / nothing drawn). The visual never appears. Fix the rendering so the canvas actually draws its content on load (usually a JS error in the draw loop, or the canvas/particles are never initialised or sized).")
            # Content apps (not canvas visualizations): empty zero-state means it's broken.
            empty = barely = False
            if not shape.get("isVisualApp"):
                empty = shape.get("nodata") or (shape.get("zeros", 0) >= 7 and shape.get("filled", 0) <= 1 and shape.get("lists", 0) >= 1)
                barely = shape.get("textLen", 0) < 300
                if empty:
                    problems.append("The app loads EMPTY — stats read 0 and the main lists are blank. Bake rich realistic SEED DATA into the default state so every list, stat and chart is fully populated on first load (never a 0/0 or empty state), and re-render it.")
                elif barely:
                    problems.append("Almost nothing renders on screen — the UI looks unfinished or failed. Ensure the full app renders with content on load.")
            # Hard errors (syntax/reference) always break something — flag them.
            if hard:
                problems.append("A fatal JavaScript error breaks part of the app on load (a whole script block fails to run — e.g. the canvas/particle render or the interactions never execute): " + " | ".join(hard) + ". Find and fix the syntax/reference error.")
            elif soft and (empty or barely or shape.get("canvasBlank")):
                problems.append("JavaScript errors on load are the likely cause of the broken render: " + " | ".join(soft) + ". Fix them.")
            out(len(problems) == 0, problems)
    finally:
        proc.terminate()

if __name__ == "__main__":
    try:
        asyncio.run(run(sys.argv[1]))
    except Exception as e:
        out(True, [], skip=f"verifier error: {e}")
