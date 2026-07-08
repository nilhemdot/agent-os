# 22 · Leads — Find People to Reach Out To (Optional)

The **Leads** tab finds real prospects for your outreach — companies + the right contact emails — so you're not hunting them by hand. It feeds straight into the outreach/backlink campaigns (see the email + outreach guides).

You can start **free** and only add paid sources if you want more volume.

## The four ways to get leads
- **Auto** — describe your ideal customer (your "ICP"); the AI suggests real companies and pulls contacts for them.
- **Paste CSV** — already have a list? Paste it in and it's cleaned up for you. *(No key needed.)*
- **Domains** — paste a list of company domains; **Hunter** finds the contact emails (Hunter has a free tier).
- **Apollo** — search **Apollo.io's** people database from your ICP (paid — biggest volume).

It can also use **Firecrawl** to read a company's site for extra context when enriching a lead.

## Keys (all optional — add only the sources you want)
None of these are required to open the tab. Add a key to switch on that source:

- **Hunter** (`HUNTER_API_KEY`) — email finder. **Free tier** to start: <https://hunter.io>
- **Apollo** (`APOLLO_API_KEY`) — people/company database (paid): <https://www.apollo.io>
- **Firecrawl** (`FIRECRAWL_API_KEY`) — site scraping for enrichment (free tier): <https://firecrawl.dev>

*(You create these accounts and copy the keys yourself — never let an AI enter your card.)*

## Where to put the keys
Two easy options:
- **In the Leads tab settings** — paste them in the UI (saved to `~/.agentic-os/outreach/config.json`, locked to your account).
- **Or as environment variables** — `HUNTER_API_KEY`, `APOLLO_API_KEY`, `FIRECRAWL_API_KEY`.

> 🟢 Easiest: open Claude Code (or any agent) and say *"add my Hunter / Apollo / Firecrawl keys to the Leads tool"* and paste the keys when it asks.

## How to use it
1. Open the **Leads** tab.
2. Pick a source (start with **Domains** or **CSV** — both are free).
3. Describe your ICP or paste your list → it returns scored, de-duplicated leads.
4. Hand them to your outreach campaign (see the email-outreach guide) to contact them.

## Good to know
- **Start free.** Hunter's free tier + CSV + Domains get you going with no spend.
- **Your keys, your costs.** Apollo/Firecrawl bill you directly for what you use.
- **A source with no key just stays off** — the tab never breaks.

## Done?
Pair this with the email-outreach setup so Hermes can actually contact the leads you find.
