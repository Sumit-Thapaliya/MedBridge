const prisma = require("../../config/db");

/**
 * InventoryContext - RAG layer that fetches live MedBridge data for LLM.
 *
 * Privacy rules:
 * - A user's own hospital inventory may be shown only for a specific medicine
 *   or a clear, explicit request for their complete inventory.
 * - An unknown, invalid, or missing medicine name must never fall back to
 *   returning the whole inventory.
 * - Cross-hospital queries reveal only coarse availability labels, never
 *   exact quantities, batch numbers, pricing, or expiry information.
 */
class InventoryContext {
  static async getContextForQuery(query, hospitalId, userId) {
    if (!query) return "";

    const q = query.toLowerCase();

    try {
      const needs = {
        inventory:
          q.includes("inventory") ||
          q.includes("medicines") ||
          q.includes("stock") ||
          q.includes("medicine") ||
          q.includes("drug") ||
          q.includes("available") ||
          q.includes("have") ||
          q.includes("cost") ||
          q.includes("price") ||
          q.includes("how much"),

        expiring: q.includes("expire"),
        lowStock: q.includes("low") || q.includes("critical"),
        exchange: q.includes("exchange") || q.includes("request"),
        hospitals: q.includes("hospital"),

        cost:
          q.includes("cost") ||
          q.includes("price") ||
          q.includes("how much") ||
          q.includes("pricing"),

        specificMedicine: this.extractMedicineName(query),
      };

      /*
       * A cross-hospital question ("which hospital has X", "who has X") asks
       * about OTHER hospitals, not the caller's own stock. In that case we
       * must only inject the redacted partner-hospital availability built
       * above — never the caller's own detailed inventory (batch, quantity,
       * price, expiry).
       */
      const isCrossHospitalQuery = this.isCrossHospitalQuery(q);

      const contexts = [];

      if (needs.expiring) {
        const expiring = await this.getExpiringMedicines(hospitalId);
        contexts.push(expiring);
      }

      if (needs.lowStock) {
        const low = await this.getLowStock(hospitalId);
        contexts.push(low);
      }

      if (needs.exchange) {
        const exchanges = await this.getExchangeRequests(hospitalId);
        contexts.push(exchanges);
      }

      if (needs.hospitals && (q.includes("which") || q.includes("hospital"))) {
        const hospitals = await this.getHospitalsContext(query, hospitalId);
        contexts.push(hospitals);
      }

      /*
       * PRIVACY FIX
       *
       * Never call getInventoryForMedicine(hospitalId, null).
       * Doing that would query every medicine in the user's hospital.
       *
       * General inventory is allowed only for an intentional, explicit
       * request such as "show my inventory" or "list all medicines".
       *
       * For cross-hospital questions we skip this entire section — the caller
       * is asking about partner hospitals, so only the redacted availability
       * list (added above) should be provided.
       */
      if (!isCrossHospitalQuery) {
        if (needs.specificMedicine) {
          const inventory = await this.getInventoryForMedicine(
            hospitalId,
            needs.specificMedicine,
            needs.cost
          );

          contexts.push(inventory);
        } else if (this.isExplicitGeneralInventoryRequest(q)) {
          const inventory = await this.getGeneralInventory(hospitalId);
          contexts.push(inventory);
        } else if (needs.inventory || needs.cost) {
          contexts.push(
            "INVENTORY SEARCH: No exact medicine name was identified. " +
              "Do not reveal general inventory, stock quantities, batch details, " +
              "expiry dates, or prices. Ask the user to provide the exact medicine name."
          );
        }
      }

      const combined = contexts.filter(Boolean).join("\n\n");

      return (
        combined ||
        "No relevant MedBridge inventory data found for this query."
      );
    } catch (err) {
      console.error("[InventoryContext] Error fetching context:", err.message);

      // Do not send technical database errors to the LLM or user.
      return (
        "Inventory data is temporarily unavailable. " +
        "Do not infer or invent inventory, pricing, quantity, batch, or hospital availability."
      );
    }
  }

  /**
   * True when the query is asking about OTHER hospitals' stock ("which
   * hospital has X", "who has X"), as opposed to the caller's own inventory.
   * In the cross-hospital case we must not leak the caller's own detailed
   * inventory (batch / quantity / price / expiry).
   */
  static isCrossHospitalQuery(query) {
    const q = String(query || "").toLowerCase();
    if (!q.includes("hospital")) return false;
    if (!/(which|what|who|where|does any|has any)/.test(q)) return false;
    if (/(\bmy\b|\bour\b|we have|do we|we carry)/.test(q)) return false;
    return true;
  }

  /**
   * Full inventory disclosure is allowed only for explicit user requests.
   * Invalid medicine-name searches must not qualify as a general inventory request.
   */
  static isExplicitGeneralInventoryRequest(query) {
    const normalized = String(query || "")
      .toLowerCase()
      .trim()
      .replace(/[?.!]+$/, "");

    const allowedPatterns = [
      /^(show|list|display|view)\s+(all\s+)?(my|our|the)?\s*(inventory|medicines|medicine stock|stock)$/,
      /^(show|list|display|view)\s+(my|our)\s+(inventory|medicines|medicine stock|stock)$/,
      /^what medicines do we have$/,
      /^what is in (my|our) inventory$/,
    ];

    return allowedPatterns.some((pattern) => pattern.test(normalized));
  }

  static extractMedicineName(query) {
    const q = String(query || "").toLowerCase();

    const common = [
      "paracetamol",
      "acetaminophen",
      "insulin",
      "amoxicillin",
      "ibuprofen",
      "ceftriaxone",
      "azithromycin",
      "metformin",
      "atorvastatin",
      "omeprazole",
      "salbutamol",
      "ciprofloxacin",
      "diclofenac",
      "cephalexin",
      "doxycycline",
      "levothyroxine",
      "losartan",
      "amlodipine",
      "cetirizine",
      "pantoprazole",
      "montelukast",
      "tramadol",
      "vitamin",
      "metronidazole",
      "ors",
      "iron",
    ];

    for (const med of common) {
      if (q.includes(med)) return med;
    }

    const patterns = [
      /(?:have|has|available|show|cost|price|does|about|for)\s+(?:an?\s+)?([a-zA-Z][a-zA-Z0-9-]*)/i,
      /how much.*?(?:is|does)?\s+(?:an?\s+)?([a-zA-Z][a-zA-Z0-9-]*)/i,
      /([a-zA-Z][a-zA-Z0-9-]*)\s+cost/i,
      /price of\s+(?:an?\s+)?([a-zA-Z][a-zA-Z0-9-]*)/i,
    ];

    const stopWords = new Set([
      "much",
      "does",
      "cost",
      "price",
      "the",
      "an",
      "a",
      "is",
      "of",
      "all",
      "my",
      "our",
      "inventory",
      "medicine",
      "medicines",
      "stock",
      "drug",
      "drugs",
      "show",
      "list",
      "view",
      "display",
      "available",
      "hospital",
      "hospitals",
    ]);

    for (const pattern of patterns) {
      const match = query.match(pattern);

      if (match) {
        const word = match[1].toLowerCase();

        if (!stopWords.has(word) && word.length > 2) {
          return word;
        }
      }
    }

    return null;
  }

  static async getExpiringMedicines(hospitalId, days = 30) {
    try {
      const now = new Date();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + days);

      const medicines = await prisma.medicine.findMany({
        where: {
          hospitalId,
          expiry: {
            gte: now,
            lte: cutoff,
          },
        },
        orderBy: { expiry: "asc" },
        take: 15,
      });

      if (!medicines.length) {
        return `EXPIRING MEDICINES (next ${days} days): None found. Your inventory has no medicines expiring in this window.`;
      }

      const lines = medicines
        .map(
          (m) =>
            `- ${m.name} (${m.batch}): ${m.quantity} ${m.unit}, expires ${m.expiry
              .toISOString()
              .split("T")[0]}, status ${m.status}`
        )
        .join("\n");

      return `EXPIRING MEDICINES (next ${days} days) for this hospital:\n${lines}\nTotal: ${medicines.length} batches expiring.`;
    } catch (e) {
      return "EXPIRING MEDICINES: Inventory data is temporarily unavailable.";
    }
  }

  static async getLowStock(hospitalId) {
    try {
      const medicines = await prisma.medicine.findMany({
        where: {
          hospitalId,
          status: { in: ["LOW_STOCK", "CRITICAL"] },
        },
        orderBy: { quantity: "asc" },
        take: 15,
      });

      if (!medicines.length) {
        return "LOW STOCK: No low or critical stock found. Inventory is healthy.";
      }

      const lines = medicines
        .map(
          (m) =>
            `- ${m.name} (${m.batch}): ${m.quantity} ${m.unit} - ${m.status}, category ${m.category}`
        )
        .join("\n");

      return `LOW STOCK MEDICINES:\n${lines}\nConsider exchange requests for restocking.`;
    } catch (e) {
      return "LOW STOCK: Inventory data is temporarily unavailable.";
    }
  }

  static async getExchangeRequests(hospitalId) {
    try {
      const requests = await prisma.exchangeRequest.findMany({
        where: {
          OR: [{ fromHospitalId: hospitalId }, { toHospitalId: hospitalId }],
          status: { in: ["PENDING", "APPROVED", "IN_TRANSIT"] },
        },
        include: { fromHospital: true, toHospital: true },
        orderBy: { requestedOn: "desc" },
        take: 10,
      });

      if (!requests.length) {
        return "ACTIVE EXCHANGE REQUESTS: No active requests. All caught up.";
      }

      const lines = requests
        .map((r) => {
          const direction =
            r.toHospitalId === hospitalId
              ? "Outgoing (you requested)"
              : "Incoming (requested from you)";

          return `- [${r.status}] ${direction}: ${r.medicine} x${r.quantity} ${r.unit} | ${r.fromHospital.name} -> ${r.toHospital.name} | ${r.requestedOn
            .toISOString()
            .split("T")[0]}`;
        })
        .join("\n");

      return `ACTIVE EXCHANGE REQUESTS (Pending/Approved/In Transit):\n${lines}`;
    } catch (e) {
      return "EXCHANGE REQUESTS: Data is temporarily unavailable.";
    }
  }

  /**
   * Converts exact partner stock into a non-sensitive availability category.
   */
  static stockLevelLabel(totalQuantity) {
    if (totalQuantity >= 500) return "High stock";
    if (totalQuantity >= 100) return "Moderate stock";
    if (totalQuantity > 0) return "Limited stock";
    return "Out of stock";
  }

  static async getHospitalsContext(query, hospitalId) {
    try {
      const medicineName = this.extractMedicineName(query);

      /*
       * PRIVACY FIX:
       * If no valid medicine can be extracted, do not list all partner
       * hospitals, medicine-type counts, ratings, or availability.
       */
      if (!medicineName) {
        return (
          "HOSPITAL MEDICINE SEARCH: No exact medicine name was identified. " +
          "Do not reveal partner hospitals, medicine-type counts, availability, " +
          "or inventory data. Ask the user to provide the exact medicine name."
        );
      }

      const hospitalsWithMed = await prisma.medicine.findMany({
        where: {
          // Exact matching prevents partial/wrong terms such as "insul"
          // from disclosing Insulin availability.
          name: { equals: medicineName, mode: "insensitive" },
          quantity: { gt: 0 },
          ...(hospitalId ? { hospitalId: { not: hospitalId } } : {}),
        },
        include: { hospital: true },
        take: 20,
      });

      if (!hospitalsWithMed.length) {
        return `PARTNER HOSPITALS WITH ${medicineName.toUpperCase()}: No partner hospital in the network currently shows an exact match for this medicine in stock.`;
      }

      const grouped = {};

      hospitalsWithMed.forEach((medicine) => {
        const hospitalName = medicine.hospital.name;

        if (!grouped[hospitalName]) {
          grouped[hospitalName] = {
            hospital: medicine.hospital,
            total: 0,
          };
        }

        grouped[hospitalName].total += medicine.quantity;
      });

      const lines = Object.values(grouped)
        .map(
          (group) =>
            `- ${group.hospital.name} (${group.hospital.location}): ${this.stockLevelLabel(
              group.total
            )}`
        )
        .join("\n");

      return `PARTNER HOSPITALS THAT MAY HAVE ${medicineName.toUpperCase()}:\n${lines}\nExact quantities, batch numbers, pricing, and expiry details are private to each hospital. Submit an Exchange Request to confirm availability and arrange a transfer.`;
    } catch (e) {
      return "HOSPITAL MEDICINE SEARCH: Partner availability is temporarily unavailable.";
    }
  }

  static async getInventoryForMedicine(
    hospitalId,
    medicineName,
    isCostQuery = false
  ) {
    try {
      /*
       * Defence in depth:
       * This method must never return all inventory unless it was intentionally
       * called by getGeneralInventory().
       */
      if (!medicineName) {
        return (
          "INVENTORY SEARCH: No exact medicine name was provided. " +
          "Do not reveal general inventory, quantity, batch, expiry, or pricing information."
        );
      }

      const medicines = await prisma.medicine.findMany({
        where: {
          hospitalId,
          // Exact matching prevents partial names from returning another medicine.
          name: { equals: medicineName, mode: "insensitive" },
        },
        orderBy: { quantity: "desc" },
        take: 10,
      });

      if (!medicines.length) {
        return `INVENTORY SEARCH FOR "${medicineName}": No exact matching medicine was found in your hospital inventory. Do not reveal other inventory records.`;
      }

      const lines = medicines
        .map((m) => {
          const expiryStr = m.expiry
            ? new Date(m.expiry).toISOString().split("T")[0]
            : "unknown";

          if (isCostQuery) {
            return `- ${m.name} | Batch: ${m.batch} | Unit Price: $${m.unitPrice} per ${m.unit} | Qty: ${m.quantity} ${m.unit} available | Category: ${m.category} | Expiry: ${expiryStr} | Status: ${m.status}`;
          }

          return `- ${m.name} | Batch: ${m.batch} | Qty: ${m.quantity} ${m.unit} | Category: ${m.category} | Expiry: ${expiryStr} | Status: ${m.status} | Price: $${m.unitPrice} per ${m.unit}`;
        })
        .join("\n");

      const totalQty = medicines.reduce((sum, m) => sum + m.quantity, 0);
      const totalValue = medicines.reduce(
        (sum, m) => sum + m.quantity * (m.unitPrice || 0),
        0
      );

      const prefix = isCostQuery
        ? `COST/PRICING FOR "${medicineName.toUpperCase()}" - Live inventory pricing`
        : `INVENTORY FOR "${medicineName}"`;

      const costSummary = isCostQuery
        ? `\nTotal inventory value for this result: $${totalValue.toFixed(
            2
          )}. Prices are from the live hospital inventory system.`
        : "";

      return `${prefix} (Total units in result: ${totalQty})${costSummary}:\n${lines}`;
    } catch (e) {
      return "INVENTORY SEARCH: Inventory data is temporarily unavailable.";
    }
  }

  static async getGeneralInventory(hospitalId) {
    try {
      const medicines = await prisma.medicine.findMany({
        where: { hospitalId },
        orderBy: { quantity: "desc" },
        take: 20,
      });

      if (!medicines.length) {
        return "GENERAL INVENTORY: No medicines found in your hospital inventory.";
      }

      const lines = medicines
        .map((m) => {
          const expiryStr = m.expiry
            ? new Date(m.expiry).toISOString().split("T")[0]
            : "unknown";

          return `- ${m.name} | Batch: ${m.batch} | Qty: ${m.quantity} ${m.unit} | Category: ${m.category} | Expiry: ${expiryStr} | Status: ${m.status} | Price: $${m.unitPrice} per ${m.unit}`;
        })
        .join("\n");

      return `CURRENT INVENTORY (top 20 by quantity):\n${lines}`;
    } catch (e) {
      return "GENERAL INVENTORY: Inventory data is temporarily unavailable.";
    }
  }
}

module.exports = InventoryContext;