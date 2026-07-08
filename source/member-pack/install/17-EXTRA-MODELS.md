# 17 · Extra AI Models — GLM 5.2, Fusion & Sakana Fugu (Optional)

Three more brains you can chat with, each in its own sidebar tab. They're simple: paste one API key and the tab works — no app to install.

- **GLM 5.2** — Zhipu's GLM-5.2 model (strong, great value).
- **Fusion** — OpenRouter's "Fusion" model (blends Fable 5 + GPT-5.5 + open-weights into one answer).
- **Sakana Fugu** — Sakana's multi-agent panel API (same panel idea, ~4× cheaper per call than Fusion in my bench).

Use the one(s) you like, skip the rest. A tab with no key just stays quiet.

## A · GLM 5.2
1. Get a key from **https://z.ai** (Zhipu) — sign up and copy your **API key**. *(You do this yourself — never let an AI enter your card.)*
2. Save it:
   ```bash
   mkdir -p ~/.hermes/profiles/glm-5-2
   echo 'GLM_API_KEY=your_key_here' > ~/.hermes/profiles/glm-5-2/.env
   chmod 600 ~/.hermes/profiles/glm-5-2/.env
   ```
3. Restart the dashboard → open the **GLM 5.2** tab and chat.

> Power-user note: the dashboard also accepts the key as a `GLM_API_KEY`, `ZAI_API_KEY`, or `Z_AI_API_KEY` environment variable if you prefer that over the profile file.

## B · Fusion
Fusion runs through **OpenRouter** — so if you already set up Hermes (`4-HERMES.md`), **you're done**; it reuses that same `OPENROUTER_API_KEY`.

If you haven't:
1. Get a key from **https://openrouter.ai** (add a few dollars of credit).
2. Save it:
   ```bash
   mkdir -p ~/.hermes/profiles/main
   echo 'OPENROUTER_API_KEY=your_key_here' > ~/.hermes/profiles/main/.env
   chmod 600 ~/.hermes/profiles/main/.env
   ```
3. Restart the dashboard → open the **Fusion** tab and chat.

## C · Sakana Fugu

Sakana's panel API is the newest addition — same multi-agent idea as Fusion, OpenAI-compatible, but priced much lower per call. On my Goldie Bench (42 identical one-shot HTML prompts), Fugu Ultra is currently #1 ahead of Fusion at roughly **1/4 the cost** for comparable output. Worth wiring up if you run high-volume agent loops.

1. Get a key from **https://console.sakana.ai/login** (Sakana account). They offer flat-rate plans ($20 / $100 / $200 a month) or pay-as-you-go ($5/M input + $30/M output for Fugu Ultra). Pick what matches your loop.
2. Save it:
   ```bash
   mkdir -p ~/.hermes/profiles/sakana-fugu
   echo 'SAKANA_API_KEY=your_key_here' > ~/.hermes/profiles/sakana-fugu/.env
   chmod 600 ~/.hermes/profiles/sakana-fugu/.env
   ```
3. The endpoint is OpenAI-compatible at `https://api.sakana.ai/v1`. Model IDs: `fugu`, `fugu-ultra`, `fugu-ultra-20260615`.
4. Restart the dashboard → open the **Fugu** tab and chat. Same UX as the Fusion tab.

> Power-user note: any tool that speaks OpenAI's chat-completion format (your own Python script, an Agent OS dispatcher, a coding harness) just needs the base URL `https://api.sakana.ai/v1` and the Sakana key. No SDK migration.

> When to pick which: **Fusion** for the rich panel (Fable 5 + GPT-5.5 in the mix). **Fugu Ultra** when cost per call is the deciding factor and you want a vendor-agnostic ensemble. See the full head-to-head at **https://goldiebench.com** and the comparison guide at **https://agentos.guide/sakana-fugu-vs-fusion**.

## Try it
Open any tab and ask the same question you'd ask Claude — compare the answers. Different panels have different strengths; it's handy to have a second (and third) opinion on tap.

## Done?
That's the extra models. For the installed coding agents (Claude, Codex, Gemini, etc.), see **`7-AGENT-CLIS.md`**; for Kimi, **`16-KIMI-CODE.md`**.
