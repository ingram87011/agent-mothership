# Dark Web Threat Intelligence Report

**Generated:** 2026-07-10
**Method:** Tor MCP Server — automated scraping via Ahmia.fi search + direct .onion access
**Tor Exit IP:** Anonymized (rotated per session)

---

## Methodology

1. Searched Ahmia.fi (clearnet Tor search engine) through Tor for 9 threat intelligence queries
2. Collected 72 .onion URLs across all queries
3. Deep-scraped 7 live .onion sites for full content
4. All findings saved to `/project/workspace/findings/darkweb/`

---

## Search Results Summary

| Query | Results | Notable Finds |
|-------|---------|---------------|
| gift card | 8 | Active $500 gift card shop |
| giftcard | 8 | Coinbase giftcard vendor, Legit Vendor market |
| credential leaks | 8 | SyS Leaks site (Apple, Adobe leaks) |
| login credentials | 8 | Darknet News credential channel |
| stolen accounts | 8 | PayPal accounts, BTC wallets, bank accounts |
| credit card | 8 | Active CC market |
| dumps | 8 | Carding market |
| paypal | 8 | PayPal access seller |
| bank login | 8 | Bank login carding shops |

---

## Live .onion Sites — Deep Scrape Results

### 1. Gift Card Shop
- **URL:** `http://b3sfuqzn5ty33hvz2fi3wdouypc4pr4afttalyl6d2qaolorn776hiqd.onion/`
- **Status:** 200
- **Description:** Sells $500 Visa/Mastercard gift cards for $35. Instant email delivery. BTC payment via BTCPay Server.
- **Payment Link:** BTCPay invoice on demo.mainnet.btcpayserver.org ($35 USD)

### 2. SyS Leaks
- **URL:** `http://wa2y26bd7vw4xpy6hglnrnsrk54ouveaqxiuutjkejccqqnwgcryvuqd.onion/`
- **Status:** 200
- **Description:** Data leak website. Posts leaks including Apple, AdobeC2, CL FN External, DriverFN. Offers removal for $450 XMR. Contact via t.me/sysleaks.
- **Leaks Posted:** Apple (2024-01-28), CL FN External (2024-01-28), DriverFN (2024-01-27), AdobeC2 (2024-01-27)

### 3. Credit Card Market
- **URL:** `http://k3emqmv7q5kb6ureb5dmwxuw7spoph6unb4hzns4lupibiozrgy67dqd.onion/`
- **Status:** 200
- **Description:** Sells verified credit card info for $19/each. $300-$1500 limits. Includes PDF cash-out guide. BTC payment. Claims replacement/refund policy.
- **Payment Link:** BTCPay invoice ($19 USD)

### 4. PayPal Shop
- **URL:** `http://3bcltc4v5idydloh47pp5enfmc525o4jf4fgy5p5fxvifwe7yslvxmqd.onion/`
- **Status:** 200
- **Description:** PayPal account access seller. 11 product pages. Keyword-stuffed SEO spam.

### 5. Legit Vendor Marketplace
- **URL:** `http://legitv6ltmpwhdxltfkautpxeeif36gu7a5pgbuijaxmdvhxcxpkhlid.onion/`
- **Status:** 404 (product page dead)
- **Description:** Multi-category market: counterfeit money, clone cards, escrow, fixed matches, gift cards, hackers, PayPal, prepaid cards.
- **Contact:** best-legit-vendor@keemail.me

---

## Payment Infrastructure Observed

- **BTCPay Server** — Two sites use `mainnet.demo.btcpayserver.org` (demo instance)
- **Cryptocurrencies:** BTC (BTCPay), XMR (SyS Leaks removal)
- **Email delivery:** Gift cards sent to buyer's email

---

## Key Observations

1. **All sites are storefronts** — No free leaked credentials or gift card codes found. Everything requires payment.
2. **Same BTCPay instance** — Both Gift Card Shop and Credit Card Market use the same BTCPay server (`storeId=EhWukp6qAv3BgcXqndWRushfuaspLPEMR365PNwH7x6p`), suggesting same operator.
3. **Low prices** — $35 for $500 gift card, $19 for CC info. Classic scam pricing (too good to be true).
4. **SyS Leaks is real** — Legitimate data leak site with confirmed breach posts. Contact via Telegram.
5. **No credential dumps found** — Searches for "credential leaks" and "stolen accounts" returned marketplaces, not actual leaked data.

---

## Files Saved

| File | Contents |
|------|----------|
| `search-results.json` | 72 .onion URLs from 9 search queries |
| `onion-scraped-data.json` | Summary scrape of 10 target .onion sites |
| `deep-scraped-content.json` | Full content from 7 live .onion sites |
| `tor-scrape-findings.json` | Raw MCP server findings log |
| `threat-intel-report.md` | This report |

---

## Tools Used

- **Tor MCP Server:** `/project/workspace/tools/tor-mcp-server.py`
- **Scrape Script:** `/project/workspace/tools/deep_scrape.py`
- **Search Script:** `/project/workspace/tools/run_searches.py`
