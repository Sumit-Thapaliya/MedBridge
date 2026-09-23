const BaseProvider = require("./BaseProvider");

/**
 * MockProvider - Development fallback when no API keys are configured
 * Provides intelligent, medically responsible responses without calling external LLM
 * Now handles cost/price queries and medical terminologies properly
 */
class MockProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.model = "mock-llm-medbridge-v1";
  }

  validateConfig() {
    return { valid: true };
  }

  // --- Response helpers -------------------------------------------------
  // Every helper below only ever returns a string that the caller puts into
  // `content`. None of them touch the return shape ({content, tokens, model}),
  // the INVENTORY CONTEXT parsing, or the keyword branches that already worked.

  /**
   * Detects a request for personal medical advice — dosing for a named person,
   * diagnosis, prescriptions. Deliberately narrow: only phrases that clearly
   * ask about the asker, so general questions ("What does Paracetamol do?")
   * still fall through to their normal branch.
   */
  detectPersonalAdviceRequest(q) {
    const phrases = [
      "should i take",
      "should i give",
      "can i give my",
      "can i give him",
      "can i give her",
      "can i take this",
      "how many tablets should",
      "how many mg should i",
      "what dose should i",
      "what dose should my",
      "prescribe me",
      "diagnose me",
      "what do i have",
      "is it safe for my baby",
      "is it safe for my child",
      "is it safe for me",
      "am i having",
      "do i have a",
    ];
    return phrases.some((p) => q.includes(p));
  }

  personalAdviceResponse() {
    return `I can't give personal dosing, diagnosis, or prescription advice — that needs a clinician who knows the patient's history, weight, allergies, and other medicines.

**What to do instead:**
- Ask the treating doctor or your hospital pharmacist for a dose — they can check interactions and adjust for age, weight, kidney and liver function
- For a child, pregnant patient, or anyone on other medicines, always confirm before giving anything
- If this is urgent (breathing difficulty, chest pain, suspected overdose, uncontrolled bleeding), treat it as an emergency

**What I *can* do here:**
- Explain a medicine: what it treats, common side effects, contraindications, storage
- Show live stock, batches, expiry dates, and unit prices from your hospital's inventory
- Tell you which partner hospitals have a medicine, so you can raise an Exchange Request

*General information only — not medical advice. Please consult a qualified healthcare professional.*`;
  }

  /**
   * Greetings and farewells get their own reply — they're social, not
   * off-topic, so they shouldn't get the "outside what I'm built for" card.
   * Word boundaries (\b) matter: a bare "hi" substring would match inside
   * "which" and "this".
   */
  detectGreeting(q) {
    const patterns = [
      /^hi\b/,
      /^hey\b/,
      /^hello\b/,
      /^yo\b/,
      /^hiya\b/,
      /^namaste\b/,
      /^good (morning|afternoon|evening)\b/,
      /\bgood (morning|afternoon|evening)\b/,
      /\bhow are you\b/,
      /\bwhat('s| is) up\b/,
      /\bsup\b/,
    ];
    return patterns.some((re) => re.test(q));
  }

  greetingResponse() {
    return `Hello! I'm **MedBridge AI** — your hospital inventory assistant. How can I help you today?

Here are a few things I can do right away:
- **Medicines** — "What does Paracetamol do?", "Side effects of Ibuprofen"
- **Live pricing** — "How much does Amoxicillin cost?"
- **Inventory** — "Which medicines expire this month?", "What is low in stock?"
- **Exchange** — "Which hospital has Ceftriaxone?"

*General information only, not medical advice.*`;
  }

  detectFarewell(q) {
    const patterns = [
      /\bbye\b/,
      /\bgoodbye\b/,
      /\bgood bye\b/,
      /\bsee (you|ya)\b/,
      /\bsee you later\b/,
      /\btake care\b/,
      /\bgood ?night\b/,
      /\blater\b/,
      /\bi('m| am) (leaving|off|done|going)\b/,
      /\bthat('s| is) all\b/,
      /\bnothing else\b/,
      /\bthanks? (bye|goodbye)\b/,
    ];
    return patterns.some((re) => re.test(q));
  }

  farewellResponse() {
    return `Goodbye! Take care. 👋

I'm here whenever you need stock levels, pricing, expiry dates, or medicine information — just open the assistant and ask.`;
  }

  /**
   * Detects questions with nothing to do with medicines or inventory.
   * Kept intentionally conservative — a false negative just shows the normal
   * capability card, while a false positive would hide a real answer, so this
   * list only contains things that can never be a medicine question.
   * Greetings and farewells are handled separately, before this runs.
   */
  detectOffTopic(q) {
    const smallTalk = [
      /\bthanks?\b/,
      /\bthank you\b/,
      /\bwho (are|r) (you|u)\b/,
      /\bwhat can you do\b/,
      /\bhelp me\b/,
      /\bwho (made|built|created) you\b/,
      /\btell me a joke\b/,
      /\bwhat('s| is) your name\b/,
    ];
    const nonMedicine = [
      "weather",
      "football",
      "cricket",
      "basketball",
      "stock market",
      "share price",
      "cryptocurrency",
      "bitcoin",
      "movie",
      "netflix",
      "recipe",
      "holiday plan",
      "flight ticket",
      "python code",
      "javascript code",
      "write code",
      "fix my code",
      "debug this",
      "sql query",
      "essay",
      "homework",
      "poem",
      "song lyrics",
      "translate this",
      "horoscope",
      "politics",
      "election",
    ];
    return smallTalk.some((re) => re.test(q)) || nonMedicine.some((p) => q.includes(p));
  }

  offTopicResponse(originalQuery) {
    const trimmed = String(originalQuery || "").trim().slice(0, 120);
    return `That's outside what I'm built for, so I'd rather be straight with you than guess${
      trimmed ? ` (you asked: "${trimmed}")` : ""
    }.

I'm the **MedBridge assistant** — I work with medicine information and this hospital's live inventory. Try one of these:

**Medicines** — "What does Paracetamol do?", "Side effects of Ibuprofen", "Can Paracetamol + Ibuprofen be taken together?"
**Pricing (live)** — "How much does Amoxicillin cost?", "Show Insulin pricing"
**Inventory** — "Which medicines expire this month?", "What is low in stock?", "Do we have Ceftriaxone?"
**Exchange** — "Which hospital has Ceftriaxone?" — then raise an Exchange Request

*General information only, not medical advice.*`;
  }

  /**
   * Turns the raw context block into a human label plus a relevant follow-up.
   * Matches the section headers InventoryContext.js actually emits, so the
   * answer says what the data is instead of a generic sentence.
   */
  describeInventoryContext(text) {
    const t = String(text || "");
    const empty = /No partner hospital|None found|No low or critical stock|No medicines found|not found/i.test(
      t
    );
    const unavailable = /temporarily unavailable/i.test(t);

    if (unavailable) {
      return {
        label: "the inventory lookup result",
        followUp:
          "The inventory service didn't respond just now. Open the **Inventory** page to check directly, or ask me again in a moment.",
      };
    }
    if (/EXPIRING MEDICINES/i.test(t)) {
      return {
        label: empty ? "the expiry check result" : "the list of batches expiring soon",
        followUp:
          "Expiry comes from the batch record in your inventory. Plan usage or an exchange before the date passes — ask \"What is low in stock?\" to see restock candidates.",
      };
    }
    if (/LOW STOCK/i.test(t)) {
      return {
        label: empty ? "the stock-level check result" : "the list of items running low",
        followUp:
          "For anything critical, ask \"Which hospital has [medicine]?\" and I will show partner hospitals so you can raise an Exchange Request.",
      };
    }
    if (/PARTNER HOSPITALS/i.test(t)) {
      return {
        label: "what partner hospitals in your exchange network have in stock",
        followUp:
          "Exact quantities, batch numbers, and prices stay private to each hospital. Raise an **Exchange Request** to confirm availability and arrange the transfer.",
      };
    }
    if (/COST\/PRICING/i.test(t)) {
      return {
        label: "live unit pricing",
        followUp:
          "**Unit Price** is cost per unit; **Total value** = quantity × unit price. Prices vary by supplier and batch — confirm with procurement before billing.",
      };
    }
    return {
      label: empty ? "what I found in your inventory" : "your current inventory",
      followUp:
        'Ask "How much does [medicine] cost?" for batch-wise unit prices, or "Which medicines expire this month?" for expiry planning.',
    };
  }

  // --- Focused medical answers (offline mode) ---------------------------
  // "What does Paracetamol do?" must answer ONLY that. The old mock dumped a
  // terminology wall; now each drug has a small knowledge sheet and we return
  // just the paragraph that matches the question's intent.

  detectDrug(q) {
    if (q.includes("paracetamol") || q.includes("acetaminophen")) return "paracetamol";
    if (q.includes("ibuprofen")) return "ibuprofen";
    if (q.includes("insulin")) return "insulin";
    if (q.includes("amoxicillin") || q.includes("amoxycillin")) return "amoxicillin";
    if (q.includes("ceftriaxone")) return "ceftriaxone";
    return null;
  }

  detectMedicalIntent(q) {
    if (/what (does|do) .+ do\b/.test(q) || q.includes("what does it do") || q.includes("how does it work") || q.includes("used for") || q.includes("uses of") || q.includes("indication")) return "does";
    if (q.includes("side effect") || q.includes("adverse") || q.includes("allergic reaction")) return "sideEffects";
    if (q.includes("together") || q.includes("interaction") || q.includes("combine") || q.includes("at the same time")) return "interaction";
    if (/^(tell me about|about)\b/.test(q) || q.includes("explain")) return "overview";
    return null;
  }

  drugKnowledgeBase() {
    return {
      paracetamol: {
        title: "Paracetamol (Acetaminophen)",
        does: "Reduces fever and relieves mild-to-moderate pain (headache, toothache, muscle ache, cold symptoms) by blocking prostaglandin production in the brain. It is gentle on the stomach, but overdose causes serious liver damage — never exceed the label dose.",
        sideEffects: "Rare at normal doses (occasional nausea or rash). The real danger is overdose: too much causes severe liver damage, so keep within the daily limit and watch for combination products that also contain paracetamol.",
        interaction: "Few interactions at normal doses. It can be taken with ibuprofen — they work differently — but never with other paracetamol-containing products. Regular heavy alcohol use or long-term warfarin use raises the risk; check with a pharmacist.",
      },
      ibuprofen: {
        title: "Ibuprofen",
        does: "An NSAID that reduces pain, fever and inflammation (muscle/joint pain, dental pain, period pain) by blocking COX enzymes at the site of inflammation. Take it with food to reduce stomach upset.",
        sideEffects: "Common: stomach upset, heartburn. With regular or high doses: stomach ulcer or bleeding, raised blood pressure, kidney injury. Avoid in active ulcer, severe kidney disease and late pregnancy.",
        interaction: "Do not combine with other NSAIDs or steroids (ulcer/bleeding risk). It can blunt blood-pressure medicines and adds bleeding risk with anticoagulants like warfarin. It can be taken with paracetamol, which works differently.",
      },
      insulin: {
        title: "Insulin",
        does: "Lowers blood glucose by letting cells take up sugar from the blood — essential in type 1 diabetes and used in advanced type 2 diabetes. Types range from rapid-acting to long-acting; dosing is individualised by a clinician.",
        sideEffects: "The main risk is hypoglycaemia — shakiness, sweating, confusion — treated with fast-acting sugar. Injection-site reactions and weight gain can also occur.",
        interaction: "Risk of low blood sugar rises with alcohol and with other glucose-lowering medicines. Dose changes must be made by the treating clinician.",
      },
      amoxicillin: {
        title: "Amoxicillin",
        does: "A penicillin-type antibiotic for chest, ear, throat, urinary and dental infections. It kills bacteria by blocking cell-wall construction. It does nothing against viral colds or flu.",
        sideEffects: "Common: nausea, diarrhoea, rash. Stop and seek care for allergy signs — wheezing, facial swelling, severe rash. Prolonged use can cause thrush.",
        interaction: "Allopurinol raises the chance of rash; it can interact with methotrexate. Complete the full course as prescribed.",
      },
      ceftriaxone: {
        title: "Ceftriaxone",
        does: "An injectable third-generation cephalosporin antibiotic for serious infections — pneumonia, sepsis, meningitis, gonorrhoea. Given IM/IV, usually once daily, covering a broad range of bacteria.",
        sideEffects: "Diarrhoea, rash, injection-site pain; rarely biliary sludging or serious allergic reaction, including in some penicillin-allergic patients.",
        interaction: "Must not be mixed with calcium-containing IV solutions. Caution with anticoagulants (can raise bleeding risk).",
      },
    };
  }

  focusedMedicalResponse(drug, intent, q) {
    const sheet = this.drugKnowledgeBase()[drug];
    let title = sheet.title;
    if (intent === "interaction" && q.includes("paracetamol") && q.includes("ibuprofen")) {
      title = "Paracetamol + Ibuprofen";
    }
    let body;
    if (intent === "does") body = sheet.does;
    else if (intent === "sideEffects") body = sheet.sideEffects;
    else if (intent === "interaction") body = sheet.interaction;
    else body = sheet.does + " **Main risks:** " + sheet.sideEffects;
    return `**${title}**\n\n${body}\n\n*General information only — not medical advice.*`;
  }

  unknownDrugResponse() {
    return `I don't have a built-in information sheet for that medicine in offline (mock) mode.\n\n**Options:**\n- Connect an LLM key (OpenRouter/Gemini) in the backend \`.env\` for full medical answers\n- Check the medicine's package leaflet or ask your pharmacist\n- Try stock/pricing instead: "Do we have [medicine]?" or "How much does [medicine] cost?"\n\n*General information only — not medical advice.*`;
  }

  async chat({ systemPrompt, messages }, options = {}) {
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    const query = (lastUser?.content || "");
    const q = query.toLowerCase();

    await new Promise(r => setTimeout(r, 400));

    let content = "";
    const hasInventoryContext = systemPrompt && systemPrompt.includes("INVENTORY CONTEXT");
    let inventoryContextText = "";
    if (hasInventoryContext) {
      try {
        inventoryContextText = systemPrompt.split("INVENTORY CONTEXT:")[1]?.split("END INVENTORY")[0]?.trim() || "";
      } catch {}
    }

    const isCostQuery = q.includes("cost") || q.includes("price") || q.includes("how much") || q.includes("pricing") || q.includes("expensive") || q.includes("cheap");
    const isParacetamol = q.includes("paracetamol") || q.includes("acetaminophen");
    const isIbuprofen = q.includes("ibuprofen");

    // Safety comes first: "how much paracetamol should I give my child" must
    // not be answered by the pricing branch, which matches on "how much".
    // Sets `content` and falls through to the shared return at the bottom.
    if (this.detectPersonalAdviceRequest(q)) {
      content = this.personalAdviceResponse();
      return {
        content,
        tokens: { prompt: 0, completion: content.length / 4, total: content.length / 4 },
        model: this.model,
      };
    }

    if (isCostQuery) {
      if (hasInventoryContext && inventoryContextText) {
        if (inventoryContextText.includes("Not found") || inventoryContextText.includes("No medicines found")) {
          content = `I checked your live MedBridge inventory, but **could not find pricing** for that medicine in your hospital.

${inventoryContextText}

**What you can do:**
- Check Inventory page for all medicines with prices
- Request stock from partner hospitals via Exchange Requests
- Prices vary by supplier, batch, and hospital — always confirm with procurement

If you tell me the exact medicine name, I can search again.`;
        } else if (inventoryContextText.includes("Unit Price") || inventoryContextText.includes("Price: $") || inventoryContextText.includes("$")) {
          content = `Based on **live MedBridge inventory pricing** for your hospital:

${inventoryContextText}

**Pricing Notes:**
- **Unit Price** = cost per unit (tablet, vial, box) — see batch details above
- **Terminology:** 
  - *Generic name* = active ingredient (e.g., Paracetamol)
  - *Batch* = manufacturing lot number
  - *Unit* = how it's counted (boxes, strips, vials)
  - *Unit Price* = price per unit from inventory system
  - *Quantity* = how many units you have in stock
  - *Total value* = quantity × unit price
- Prices may vary by supplier/hospital and over time — check with pharmacy/procurement for final billing
- You can view all pricing in **Inventory** page

Need cost for another medicine? Just ask "How much does [medicine] cost?"`;
        } else {
          content = `I tried to fetch live pricing from your MedBridge inventory, but no pricing context was available.

${inventoryContextText}

**General pricing info:** Medicine costs vary by generic vs brand, strength, dosage form, supplier and hospital contract, batch and expiry. Please check Inventory page where unit price is shown per batch.`;
        }
      } else {
        if (isParacetamol) {
          content = `**Paracetamol cost — general info + how to check live pricing:**

**General market range (varies widely):**
- Nepal: Often NPR 1-5 per tablet for generic 500mg, but depends on brand
- US: $0.02-$0.10 per 500mg tablet generic

**For YOUR hospital's actual price:**
Based on your query, I should have fetched inventory with unitPrice. Ask "How much does Paracetamol cost?" and I will query your MedBridge inventory database which has exact batch-wise pricing:

Example:
- Paracetamol | Batch: B123 | Unit Price: $0.05 per tablet | Qty: 100 tablets | Expiry: 2026-12-01

**Terminology for cost:**
- *Unit Price* = price per single unit
- *Quantity* = stock count
- *Total Value* = unit price × quantity
- *Batch* = lot number

Check **Inventory** page → search Paracetamol → you will see Unit Price column.

*Prices change - always confirm with pharmacy.*`;
        } else {
          content = `**Medicine cost / pricing:**

Medicine prices in MedBridge come from **live inventory (unitPrice field)**:
- Each batch has its own unit price per unit (box/strip/vial)
- To get exact cost, ask: "How much does [medicine name] cost?" — I will then query your hospital's live inventory

**Example questions:**
- "How much does Paracetamol cost?"
- "What is the price of Amoxicillin?"
- "Show Insulin pricing"

**Medical terminology for cost:**
- *Generic name* = Paracetamol
- *Brand name* = e.g., Tylenol
- *Strength* = 500mg
- *Dosage form* = tablet
- *Unit* = boxes, strips, tablets
- *Unit Price* = $ per unit
- *Batch* = BATCH-001

Try asking for a specific medicine now!`;
        }
      }
      return {
        content: content + "\n\n*Pricing from live inventory; general info not medical advice. Consult pharmacy for billing.*",
        tokens: { prompt: 0, completion: content.length / 4, total: content.length / 4 },
        model: this.model,
      };
    }

    // Focused medical answers: match drug + intent, answer only that.
    // Inventory-intent questions ("do we have paracetamol") carry no medical
    // intent, so they fall through to the inventory branch below.
    const drug = this.detectDrug(q);
    const medIntent = this.detectMedicalIntent(q);
    if (drug && medIntent) {
      content = this.focusedMedicalResponse(drug, medIntent, q);
      return {
        content,
        tokens: { prompt: 0, completion: content.length / 4, total: content.length / 4 },
        model: this.model,
      };
    }
    if (medIntent) {
      content = this.unknownDrugResponse();
      return {
        content,
        tokens: { prompt: 0, completion: content.length / 4, total: content.length / 4 },
        model: this.model,
      };
    }

    if (q.includes("hypertension") || q.includes("high blood pressure")) {
      content = `**Hypertension** = persistently high BP (often ≥130/80 mmHg). Terminology: Systolic/Diastolic, mmHg, essential vs secondary. Why matters: ↑ risk heart disease, stroke. Management: DASH diet low salt, exercise, weight, limit alcohol. Emergency: chest pain/severe headache → emergency services. *Educational only.*`;
    } else if (q.includes("diabetes")) {
      content = `**Diabetes** — hyperglycemia. Terminology: Type 1 autoimmune insulin deficiency, Type 2 insulin resistance, HbA1c, fasting glucose. Symptoms: Polyuria, polydipsia, polyphagia. Management: diet, exercise, monitoring. *Consult clinician.*`;
    } else if (q.includes("antibiotic")) {
      content = `**Antibiotic** — treats bacterial infections (not viral). Terminology: Generic, Spectrum, Resistance, Batch, Expiry. Take as prescribed, complete course, check expiry. Side effects: nausea, diarrhea. *Follow clinician.*`;
    } else if (this.detectGreeting(q)) {
      content = this.greetingResponse();
    } else if (this.detectFarewell(q)) {
      content = this.farewellResponse();
    } else if (this.detectOffTopic(q)) {
      content = this.offTopicResponse(query);
    } else if (hasInventoryContext) {
      // Reached when live inventory data was injected but the question matched
      // no medicine keyword above. Answering with that data beats showing the
      // generic capability card, which previously swallowed questions like
      // "Which hospital has Ceftriaxone?" and "What is low in stock?".
      const { label, followUp } = this.describeInventoryContext(inventoryContextText);
      content = `Here is ${label} from your hospital's live MedBridge inventory:

${inventoryContextText}

${followUp}`;
    } else {
      content = `I'm **MedBridge AI** — understands medical terminologies: generic name, brand name, dosage form, strength, batch, expiry, unit, unit price, category, indications, contraindications, side effects, interactions, storage.

**Medical:** What does Paracetamol do? Side effects of Ibuprofen? Can Paracetamol + Ibuprofen be taken together?
**Cost/Pricing (live):** How much does Paracetamol cost? Price of Amoxicillin? Show Insulin pricing - I will show batch-wise unitPrice, quantity, expiry
**Inventory :** Show available medicines, Which medicines expire this month?, Do we have Insulin?, Which hospital has Ceftriaxone?

**Safety:** General info only, not diagnosis/prescription. Consult professional.`;
    }

    return {
      content,
      tokens: { prompt: 0, completion: content.length / 4, total: content.length / 4 },
      model: this.model,
    };
  }
}

module.exports = MockProvider;
