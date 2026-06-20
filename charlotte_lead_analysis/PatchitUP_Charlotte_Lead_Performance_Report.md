# PatchitUP of Charlotte — Lead Spend Performance Report

**Prepared:** June 20, 2026
**Scope:** Evaluation of the $15,000 PatchitUP startUP Bundle lead spend, cross-referenced against the Charlotte GHL sub-account (location `BejxgXKqvpK9bZzmw1RZ`)
**Window covered by data:** Apr 28 – Jun 19, 2026 (~7 weeks)

---

## 1. How to read this report (definitions & caveats)

- **Lead** = a contact PatchitUP paid for (or received via subscription) on Angi or Thumbtack.
- **Booked** = that lead was matched (by name/phone) to an opportunity in the GHL sub-account, i.e. it progressed to a **booked estimate appointment**.
- **Won** = the GHL opportunity status is `won` (estimate sold / job moving forward).
- **Estimate Value** = the dollar figure on the GHL opportunity. **This is the quoted/booked estimate value, NOT realized revenue.** Treat it as *pipeline*, not cash collected.
- **Matching caveats:** Names/phones were normalized for matching; Thumbtack hides ~25% of phone numbers, so a small number of matches rely on name only. Figures are directional, not accounting-grade.
- **Spend caveats:** Only **Thumbtack** and **Angi** costs exist in the uploaded files. **Yelp, GLSA (Reserve with Google), and Google PPC spend were not provided**, so those channels are evaluated on *outcomes only*. Angi Subscription is modeled at **$980/mo × 2 months = $1,960** — adjust if the true number of billed months differs.

---

## 2. Headline numbers (the three channels we can fully measure)

| Source | Leads | Spend | $/Lead | Booked Est. | Booking % | $/Booked | Won | $/Won |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| **Thumbtack** | 120 billed¹ | $7,704 | $64.20 | 42 | **35%** | $183 | 15 | $514 |
| **Angi — Pay-Per-Lead** | 52 | $2,502 | $48.11 | 21 | **40%** | $119 | 6 | $417 |
| **Angi — Subscription** | 55 | ~$1,960² | $35.64 | 19 | **35%** | $103 | 7 | **$280** |
| **TOTAL (measured)** | **227** | **$12,166** | **$53.59** | **82** | **36%** | **$148** | **28** | **$434** |

¹ Thumbtack: 128 total contacts → 120 billed, 6 refunded, 2 spam/free (refunds/spam removed from spend).
² Subscription cost modeled at 2 months; confirm exact billed months.

**Of the $15,000 bundle, ~$12,166 (81%) is documented in these files.** The remaining ~$2,800 went to Yelp, GLSA, and Google PPC (and any setup), for which no cost report was provided.

---

## 3. What's working — channel verdicts

### 🟢 Angi Subscription — best efficiency, expand it
Lowest cost per lead (**$35.64**) and **lowest cost per won deal ($280)** of any paid channel. At $980/mo it is effectively an all-you-can-eat pipe that booked 19 estimates and produced 7 wins in the window. **This is the most defensible dollar going forward.**

### 🟢 Angi Pay-Per-Lead — highest booking rate, keep but be selective
**Best booking rate at 40%** and a healthy $119 per booked estimate. It also carried the two largest estimates in the whole dataset (Amy Smith ~$15.1k, Jane Peck ~$10.3k), which is why its "won estimate value" looks huge — but those are outliers, not the norm. **Keep it, but tighten which lead types you accept** (see §5) so you're not paying $123 for low-intent leads.

### 🟡 Thumbtack — the volume engine, but the most expensive and least efficient
Thumbtack is **63% of measured spend ($7,704)** yet delivers the **highest cost per lead ($64) and per won deal ($514)**. It books at 35% — fine, but you're paying a premium for it. It's not broken; it's *over-weighted and under-optimized*. Two concrete problems show up in the data:
- **Speed-to-lead:** booked Thumbtack leads were responded to in a median of **144 minutes**; leads that never booked sat for a median of **752 minutes** (5× slower). Faster response = more bookings, at no extra ad cost.
- **Geography/quality:** 15 Thumbtack leads were in SC ZIPs and a large share sit in "Not scheduled yet / Not hired." You're paying for leads outside the core service area and for low-intent inquiries.

### 🔴 Yelp, GLSA (Reserve with Google), Google PPC — weak, and we can't see the cost
Across the entire GHL book these three produced almost nothing: **Yelp 3 booked / 1 won, GLSA 1 booked / 0 won, Google PPC 1 booked / 0 won.** Even without their cost numbers, the *output* is poor relative to Angi/Thumbtack. **Pull the billing reports for these three before renewing** — on current evidence they are the first candidates to cut.

### ⭐ The free/owned channels are quietly the best ROI
Sources that cost ~$0 outperformed paid ones on conversion:

| Source | Booked | Won | Win % |
|---|--:|--:|--:|
| Website | 13 | 6 | 46% |
| Power Partner | 6 | 4 | 67% |
| Referral | 6 | 4 | 67% |
| Existing Client | 3 | 3 | 100% |

These convert at 46–100% versus ~30–40% for paid lead-gen, and they don't get more expensive. **As Charlotte takes over billing, the single biggest lever is shifting mix toward these.**

---

## 4. Recommended go-forward allocation (self-funded)

Now that Charlotte pays on their own card, optimize for **cost per won job**, not lead volume.

| Channel | Now | Recommendation | Why |
|---|---|---|---|
| **Angi Subscription** | $980/mo | **Keep / prioritize** | Lowest $/won ($280). Best fixed-cost pipe. |
| **Angi Pay-Per-Lead** | ~$2.5k | **Keep, filter tighter** | Best booking rate; cap categories/ZIPs to drop low-intent. |
| **Thumbtack** | ~$7.7k (63%) | **Cut to ~35–40% of budget; optimize** | Most expensive per win; fix speed-to-lead first. |
| **Yelp / GLSA / Google PPC** | unknown | **Pause & review** | Near-zero booked output; pull cost reports before spending more. |
| **Website / Referral / Power Partner / SEO** | ~$0 | **Invest time/small $** | Highest conversion, lowest cost — the durable channel. |

**Suggested monthly paid mix (excluding free channels):** Angi Subscription $980 + Angi PPL ~$1,000 (filtered) + Thumbtack ~$1,500 (capped & fast-response) ≈ **$3,500/mo**, with Yelp/GLSA/Google paused pending an ROI check. This roughly halves the cost-per-win versus the current Thumbtack-heavy mix.

---

## 5. Operational fixes that cost nothing

1. **Speed-to-lead SLA — respond in under 15 minutes.** The data shows booked leads were answered ~5× faster than dead ones. This is the cheapest conversion gain available and applies to every channel.
2. **Filter Angi & Thumbtack by ZIP/category.** Stop paying for SC and out-of-area leads and for low-value categories that rarely book.
3. **Dispute/refund aggressively.** Thumbtack already refunded 6 leads; keep flagging spam and out-of-area to recover spend.
4. **Build the referral & power-partner flywheel.** These converted at 67–100%. A simple "ask + reward" referral loop and a handful of HVAC/restoration power partners will outperform any paid channel per dollar.

---

## 6. Key risks / things to confirm

- **Estimate Value ≠ revenue.** Reported "won estimate value" (~$52k across measured channels) is *quoted* work, heavily skewed by 2 large Angi estimates (top two alone = ~$25k; median won estimate is only **$549**). Pull actual *closed/collected* revenue from GHL or accounting to compute true ROI.
- **Confirm Angi Subscription billed months** (modeled at 2) and **provide Yelp/GLSA/Google PPC spend** to complete the picture.
- **Attribution gaps:** ~25% of Thumbtack phones are hidden; a few leads may be mis-/un-matched. The lead-level tab lets you eyeball and correct any.

---

## Appendix — Files in this package

- **`PatchitUP_Charlotte_Lead_Analysis.xlsx`**
  - *Source Summary* — the table in §2, with cost-per-lead / booked / won per channel.
  - *Lead-Level Match* — every paid lead with its booked/won flag, GHL stage, and estimate value (green = booked, darker green = won).
  - *GHL All Sources (Booked)* — every source in the GHL book (paid + organic) with booked/won/completed counts.
- **`lead_level_match.csv`** — the lead-level data as plain CSV.
