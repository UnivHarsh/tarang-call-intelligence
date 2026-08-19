import { pick, chance, intBetween, COMPETITORS } from "./lib.mjs";

const A = (text) => ({ role: "agent", text });
const C = (text) => ({ role: "customer", text });

const GREETING = [
  "Namaste, main Maya bol rahi hoon Kartly customer support se. Aapki kaise madad kar sakti hoon?",
  "Hello, Kartly support, main Maya. Boliye, kya help chahiye aapko?",
  "Namaste, Kartly se Maya. Aap apni problem bata dijiye, main dekhti hoon.",
];

const VERIFY = (o) => [
  `Ji, main dekh rahi hoon — order ${o.id}, ${o.placedShort} ko place hua tha, total ${o.valueInr} rupaye. Yahi order hai na?`,
  `Ek second, main pull kar rahi hoon. Order ${o.id}, amount ${o.valueInr} rupaye. Same hai?`,
];

const HOLD = [
  "Ek second dijiye, main check karti hoon.",
  "Bas thoda sa hold kariye, main system mein dekh rahi hoon.",
  "Main abhi verify kar rahi hoon, ek minute.",
];

const ANGRY_OPENERS = [
  "Dekhiye main bahut pareshan ho chuka hoon is baat se.",
  "Yaar ye kya chal raha hai aapke yahan?",
  "Main teesri baar call kar raha hoon, har baar wahi jawab milta hai.",
];

const CLOSE_BYE = [
  "Theek hai, Kartly choose karne ke liye dhanyavaad. Aapka din shubh ho.",
  "Bilkul, koi baat ho to dobara call kijiyega. Thank you.",
];

/** Optional wrinkles that make two calls of the same scenario read differently. */
export function wrinkleCompetitor(rng, mood) {
  if (mood === "warm") return null;
  const comp = pick(rng, COMPETITORS);
  return {
    comp,
    turn: C(
      pick(rng, [
        `Dekhiye ${comp} pe mujhe ye same cheez subah tak mil jaati hai. Main kyun aapke saath rahoon?`,
        `Main ${comp} use karta tha pehle, wahan kabhi ye problem nahi aayi.`,
        `Ghar mein sab keh rahe hain ${comp} pe shift ho jao. Main soch raha hoon ab.`,
      ]),
    ),
  };
}

export const SCENARIOS = [
  // ---------------------------------------------------------------------
  {
    key: "delivery_delay_3pl",
    intent: "delivery_delay",
    rootCause: "logistics_3pl",
    weight: 16,
    build: ({ rng, order, mood, days }) => {
      const late = intBetween(rng, 1, 4);
      const turns = [
        A(pick(rng, GREETING)),
        C(
          mood === "angry"
            ? `${pick(rng, ANGRY_OPENERS)} Mera order ${late} din late hai, koi update hi nahi hai.`
            : `Haan, mera order abhi tak nahi aaya. ${late} din ho gaye promised date se.`,
        ),
        A(pick(rng, HOLD)),
        A(pick(rng, VERIFY(order))),
        C(chance(rng, 0.5) ? "Haan wahi." : "Ji bilkul, wahi order hai."),
        A(
          `Main dekh rahi hoon ki aapka parcel ${order.hub} hub mein hai aur last scan ${days} din pehle hua tha. Delivery partner ki taraf se delay hai, mujhe khed hai.`,
        ),
        C(
          mood === "angry"
            ? "Khed se kya hoga? Mujhe ye saaman kal chahiye tha, function tha ghar pe."
            : "Achha to kab tak aa jayega ab?",
        ),
        A(
          "Main is order pe priority flag laga rahi hoon aur delivery partner ko escalate kar rahi hoon. Agle 24 ghante mein aapko out-for-delivery ka SMS mil jayega.",
        ),
      ];
      let esc = 0.35;
      if (mood === "angry") {
        turns.push(C("24 ghante wali baat aap pichli baar bhi bol chuke ho."));
        turns.push(
          A(
            "Main samajh sakti hoon. Is baar main iske saath ek 100 rupaye ka Kartly credit bhi add kar rahi hoon inconvenience ke liye.",
          ),
        );
        turns.push(C("Chalo theek hai, dekhta hoon."));
        esc = 0.62;
      } else {
        turns.push(C(pick(rng, ["Theek hai, dekh lijiye please.", "Okay, karwa dijiye."])));
      }
      turns.push(A(pick(rng, CLOSE_BYE)));
      return {
        turns,
        gt: {
          resolution: "info_provided",
          resolved: false,
          contained: true,
          sentimentStart: mood === "angry" ? -0.7 : -0.35,
          sentimentEnd: mood === "angry" ? -0.25 : 0.1,
          csatPredicted: mood === "angry" ? 2 : 3,
          escalationRisk: esc,
          churnRisk: mood === "angry" ? 0.45 : 0.22,
          refundRequested: false,
          rootCauseNote: `Parcel idle at the ${order.hub} hub with no 3PL scan for ${days} days.`,
          nextBestAction:
            "Auto-escalate to the 3PL ops queue and fire a proactive SLA-breach SMS before the customer calls again.",
          summary: pick(rng, [
            `Customer chased a ${late}-day late delivery; parcel stuck at ${order.hub} with no recent 3PL scan. Agent flagged priority and promised a 24h update.`,
            `Order ${late} days past the promised date, sitting unscanned at ${order.hub}. Priority raised with the courier.`,
            `Delivery running ${late} days late with no tracking movement from ${order.hub}. Agent escalated and committed to a 24-hour update.`,
          ]),
          tags: ["sla_breach", "3pl"],
          quoteIdx: [{ i: 5, tag: "SLA breach evidence" }],
        },
      };
    },
  },

  // ---------------------------------------------------------------------
  {
    key: "cold_chain_melt",
    intent: "damaged_or_spoiled",
    rootCause: "cold_chain",
    weight: 5,
    coldChain: true,
    cityBias: { Mumbai: 3.2, Hyderabad: 2.6, Pune: 2.0, Chennai: 1.4 },
    build: ({ rng, order, mood }) => {
      const item = order.items[0];
      const turns = [
        A(pick(rng, GREETING)),
        C(`Maine kal ${item} order kiya tha. Jab packet khola to poora pighla hua tha, andar se sab bah gaya hai.`),
        A("Ohh, ye to bilkul theek nahi hua. Main abhi dekhti hoon."),
        A(pick(rng, VERIFY(order))),
        C("Haan yahi. Dekhiye box ke andar tak oil aur cream fail gaya hai, baaki saaman bhi kharab ho gaya."),
        A(
          "Main bahut sorry hoon. Kya aap app pe ek photo upload kar sakte hain? Uske baad main turant refund process kar dungi.",
        ),
        C(
          mood === "angry"
            ? "Photo bhej deta hoon, par ye teesri baar ho raha hai is mahine. Aap log ice pack daalte hi nahi ho."
            : "Haan bhej deta hoon. Par aisa hua kyun?",
        ),
        A(
          "Aapki baat bilkul valid hai. Temperature-sensitive items ke liye insulated packing honi chahiye, is order mein wo miss hui lagti hai. Main quality team ko iski report bhej rahi hoon.",
        ),
        A(`Refund ${order.valueInr} rupaye ka initiate kar diya hai, 5 se 7 working days mein aa jayega.`),
        C(mood === "angry" ? "5-7 din? Paise aapke paas turant chale gaye the." : "Theek hai."),
      ];
      if (mood === "angry") {
        turns.push(
          A("Main samajh sakti hoon. Agar aap chahein to main ye amount Kartly wallet mein instantly credit kar sakti hoon."),
        );
        turns.push(C("Nahi nahi, bank mein hi bhejo."));
      }
      turns.push(A(pick(rng, CLOSE_BYE)));
      return {
        turns,
        gt: {
          resolution: "refund_initiated",
          resolved: true,
          contained: true,
          sentimentStart: -0.6,
          sentimentEnd: mood === "angry" ? -0.3 : 0.15,
          csatPredicted: mood === "angry" ? 2 : 3,
          escalationRisk: mood === "angry" ? 0.5 : 0.25,
          churnRisk: mood === "angry" ? 0.55 : 0.3,
          refundRequested: true,
          refundAmountInr: order.valueInr,
          rootCauseNote:
            "Temperature-sensitive SKU shipped without insulated packing; product arrived melted and leaked over the rest of the order.",
          nextBestAction:
            "Block same-day dispatch of cold-chain SKUs from this hub until insulated packing is confirmed, and refund proactively on the next occurrence.",
          summary: pick(rng, [
            `${item} arrived melted and leaked across the order. Full refund initiated; packing failure reported to quality.`,
            `Customer opened the box to find ${item} liquefied, with the spill ruining the rest of the order. Refunded in full.`,
            `Cold-chain failure on ${item} — melted in transit and damaged adjacent items. Refund issued, packing flagged.`,
            `${item} unusable on arrival after melting. Agent refunded without asking for proof beyond a photo.`,
          ]),
          tags: ["cold_chain", "packaging", "monsoon"],
          policyFriction: ["Refund TAT of 5-7 working days quoted after the customer had already been charged upfront"],
          quoteIdx: [
            { i: 1, tag: "Spoilage description" },
            { i: 6, tag: "Repeat occurrence" },
          ],
          productSignal: {
            title: "Cold-chain SKUs dispatching without insulated packing",
            evidence: `Customer reports ${item} arriving fully melted, with leakage damaging adjacent items in the same box.`,
            severity: "high",
            owner: "Ops — Cold chain",
          },
        },
      };
    },
  },

  // ---------------------------------------------------------------------
  {
    key: "damaged_in_transit",
    intent: "damaged_or_spoiled",
    rootCause: "logistics_3pl",
    weight: 7,
    fragile: true,
    build: ({ rng, order }) => {
      const item = order.items[0];
      const wantsReplacement = chance(rng, 0.55);
      const turns = [
        A(pick(rng, GREETING)),
        C(`${item} ka packet toota hua aaya hai. Poori bottle leak ho gayi, box geela tha jab delivery boy ne diya.`),
        A("Sorry sunkar bura laga. Ek second, order details dekh leti hoon."),
        A(pick(rng, VERIFY(order))),
        C("Haan."),
        A("Kya delivery ke time aapne box ki condition delivery partner ko batayi thi?"),
        C(
          chance(rng, 0.5)
            ? "Haan bataya tha, wo bola app pe complaint kar dena."
            : "Nahi, wo jaldi mein tha, mujhe baad mein pata chala andar se.",
        ),
        A("Koi baat nahi, main note kar rahi hoon. Aapke liye replacement bhejun ya refund kar dun?"),
        C(
          wantsReplacement
            ? "Replacement bhej do, cheez to chahiye hi mujhe."
            : "Refund hi kar do, main kahin aur se le lunga.",
        ),
        A(
          wantsReplacement
            ? "Theek hai, replacement schedule kar diya hai, 2 working days mein pahunch jayega. Purana packet pickup ki zaroorat nahi hai."
            : `Refund ${order.valueInr} rupaye ka initiate kar diya hai, 5 se 7 working days mein aa jayega.`,
        ),
        A(pick(rng, CLOSE_BYE)),
      ];
      return {
        turns,
        gt: {
          resolution: wantsReplacement ? "replacement_scheduled" : "refund_initiated",
          resolved: true,
          contained: true,
          sentimentStart: -0.45,
          sentimentEnd: 0.2,
          csatPredicted: 4,
          escalationRisk: 0.15,
          churnRisk: 0.18,
          refundRequested: !wantsReplacement,
          refundAmountInr: wantsReplacement ? 0 : order.valueInr,
          rootCauseNote:
            "Liquid SKU leaked in transit; the outer box was already wet at handover, which points at handling rather than packing at origin.",
          nextBestAction:
            "Sample-audit the damage rate on this lane and require leak-proof secondary packing for liquids above 1L.",
          summary: `${item} leaked in transit and soaked the box. ${wantsReplacement ? "Replacement scheduled." : "Refund initiated."}`,
          tags: ["damage", "liquids"],
          quoteIdx: [{ i: 1, tag: "Damage on arrival" }],
        },
      };
    },
  },

  // ---------------------------------------------------------------------
  {
    key: "missing_item",
    intent: "wrong_or_missing_item",
    rootCause: "warehouse_pick_error",
    weight: 9,
    build: ({ rng, order, mood }) => {
      const missing = order.items[order.items.length - 1];
      const repeat = mood === "angry";
      const turns = [
        A(pick(rng, GREETING)),
        C(`Mera order aaya hai lekin usme ${missing} hai hi nahi. Invoice pe likha hai par packet mein nahi mila.`),
        A(pick(rng, HOLD)),
        A(pick(rng, VERIFY(order))),
        C("Haan, aur baaki sab items aa gaye hain, bas yahi ek missing hai."),
        A(
          "Main dekh rahi hoon ki ye item pack list mein tha. Lagta hai packing ke time reh gaya. Main iske liye refund ya redelivery arrange kar sakti hoon.",
        ),
        C(
          repeat
            ? "Refund mat karo, cheez chahiye. Aur ye dusri baar hua hai, pichhli baar bhi ek item missing tha."
            : "Redelivery kara dijiye.",
        ),
        A(
          "Bilkul, main is item ki redelivery schedule kar rahi hoon, 2 working days mein aa jayega. Aur inconvenience ke liye 50 rupaye ka credit add kar diya hai.",
        ),
        C(pick(rng, ["Theek hai, thank you.", "Okay, dekh leta hoon."])),
        A(pick(rng, CLOSE_BYE)),
      ];
      return {
        turns,
        gt: {
          resolution: "replacement_scheduled",
          resolved: true,
          contained: true,
          sentimentStart: -0.4,
          sentimentEnd: 0.25,
          csatPredicted: repeat ? 3 : 4,
          escalationRisk: repeat ? 0.35 : 0.12,
          churnRisk: repeat ? 0.4 : 0.15,
          refundRequested: false,
          repeatCaller: repeat,
          rootCauseNote: `${missing} was on the pack list but absent from the shipped box — a short-pick at the fulfilment centre.`,
          nextBestAction:
            "Pull the pack-station video for this order ID and add a weight-check gate for multi-item boxes.",
          summary: pick(rng, [
            `${missing} was missing from a delivered order despite being on the invoice. Redelivery scheduled with a goodwill credit.`,
            `Invoice listed ${missing} but the box did not contain it. Short-pick at the FC; redelivery booked.`,
            `Customer received everything except ${missing}. Agent arranged redelivery and added a credit for the trouble.`,
          ]),
          tags: ["short_pick", repeat ? "repeat_issue" : "first_time"],
          quoteIdx: [{ i: 1, tag: "Missing item claim" }],
        },
      };
    },
  },

  // ---------------------------------------------------------------------
  {
    key: "refund_tat_chase",
    intent: "refund_status",
    rootCause: "policy_friction",
    weight: 11,
    build: ({ rng, order, mood }) => {
      const days = intBetween(rng, 6, 13);
      const angry = mood === "angry";
      const turns = [
        A(pick(rng, GREETING)),
        C(`Mera refund abhi tak nahi aaya. ${days} din ho gaye, aur har baar bolte hain 5-7 working days.`),
        A(pick(rng, HOLD)),
        A(pick(rng, VERIFY(order))),
        C("Haan wahi."),
        A(
          `Main dekh rahi hoon ki refund humari taraf se ${intBetween(rng, 2, 5)} din pehle process ho chuka hai, reference number ke saath. Bank ko credit karne mein aur 3 se 5 working days lag sakte hain.`,
        ),
        C(
          angry
            ? "Ye bahana har baar milta hai. Paise kaatne mein to 2 second lagte hain aapko."
            : "Achha, to mujhe kya karna chahiye?",
        ),
        A(
          "Main aapko refund ka ARN reference SMS kar rahi hoon. Aap wo apne bank ko de sakte hain. Agar 3 din mein credit nahi hua to main isko payments team ke paas escalate kar dungi.",
        ),
      ];
      if (angry) {
        turns.push(C("Main aur wait nahi karunga. Kisi senior se baat karao."));
        turns.push(A("Bilkul, main abhi aapko senior specialist ke paas transfer kar rahi hoon. Line pe rahiye."));
      } else {
        turns.push(C("Theek hai, SMS bhej dijiye."));
        turns.push(A(pick(rng, CLOSE_BYE)));
      }
      return {
        turns,
        gt: {
          resolution: angry ? "escalated_human" : "info_provided",
          resolved: !angry,
          contained: !angry,
          handoffReason: angry ? "Customer explicitly asked for a senior after a repeat refund chase" : null,
          sentimentStart: -0.55,
          sentimentEnd: angry ? -0.5 : 0.05,
          csatPredicted: angry ? 1 : 3,
          escalationRisk: angry ? 0.85 : 0.4,
          churnRisk: angry ? 0.6 : 0.3,
          refundRequested: true,
          refundAmountInr: order.valueInr,
          repeatCaller: true,
          rootCauseNote: `Refund was processed on our side, but the ${days}-day end-to-end wait plus the absence of a proactive ARN generated a repeat contact.`,
          nextBestAction:
            "Push the ARN by SMS automatically at refund-processed time — this call exists only because that message was never sent.",
          summary: pick(rng, [
            `Repeat call chasing a refund ${days} days after return. Money was already released; the gap is bank settlement plus no proactive ARN.`,
            `Customer called again about a refund pending ${days} days. Already processed our side — the wait is bank settlement, and nobody told them.`,
            `Second contact on the same refund, now ${days} days old. Agent shared the ARN that should have gone out automatically.`,
          ]),
          tags: ["repeat_contact", "refund_tat"],
          policyFriction: ["5-7 working day refund TAT", "No proactive ARN communication at refund-processed"],
          quoteIdx: [
            { i: 1, tag: "Repeat contact" },
            { i: 6, tag: "Trust erosion" },
          ],
        },
      };
    },
  },

  // ---------------------------------------------------------------------
  {
    key: "coupon_app_bug",
    intent: "offer_not_applied",
    rootCause: "app_bug",
    weight: 3,
    build: ({ rng, order, mood }) => {
      const disc = Math.round(order.valueInr * 0.3);
      const turns = [
        A(pick(rng, GREETING)),
        C("Aapka MONSOON30 coupon apply hi nahi ho raha hai. Cart mein daalta hoon to error aata hai."),
        A("Main dekhti hoon. Aap cart value kitni hai bata sakte hain?"),
        C(`${order.valueInr} rupaye. Minimum to 499 hai na? Wo to cross ho raha hai.`),
        A(pick(rng, HOLD)),
        A("Aap konsa phone use kar rahe hain, aur app ka version pata hai?"),
        C(
          pick(rng, [
            "Android hai, purana Redmi. Version to nahi pata, jo bhi Play Store se aaya tha.",
            "Android phone hai mera, Samsung. App update to kar chuka hoon.",
            "Android hai. Maine app delete karke dobara install bhi kiya, wahi problem.",
          ]),
        ),
        A(
          `Samajh gayi. Aap ek kaam kariye, main aapke account pe wo discount manually apply kar deti hoon. Aap order place kar dijiye, main ${disc} rupaye ka credit turant add kar dungi.`,
        ),
        C(
          mood === "angry"
            ? "Har baar manual kyun karna padega? Offer dikhta hai to lagna bhi chahiye na."
            : "Achha theek hai, chalta hai.",
        ),
        A("Aap bilkul sahi keh rahe hain. Main ye technical team ko report kar rahi hoon taaki app mein hi fix ho jaye."),
        A(pick(rng, CLOSE_BYE)),
      ];
      return {
        turns,
        gt: {
          resolution: "resolved_self_serve",
          resolved: true,
          contained: true,
          sentimentStart: -0.35,
          sentimentEnd: mood === "angry" ? -0.1 : 0.3,
          csatPredicted: mood === "angry" ? 3 : 4,
          escalationRisk: 0.2,
          churnRisk: 0.25,
          refundRequested: false,
          rootCauseNote:
            "MONSOON30 fails to apply on Android for carts that clear the minimum value — a client-side validation bug, not a T&C misunderstanding.",
          nextBestAction:
            "File a P1 against the coupon validation path on Android; every one of these calls is a checkout the customer nearly abandoned.",
          summary:
            "MONSOON30 coupon would not apply on Android despite the cart clearing the minimum. Agent applied the discount manually and flagged engineering.",
          tags: ["coupon", "android", "checkout_blocker"],
          quoteIdx: [
            { i: 1, tag: "Bug report" },
            { i: 6, tag: "Platform signal" },
          ],
          productSignal: {
            title: "MONSOON30 silently fails on Android at checkout",
            evidence:
              "Cart clears the 499 minimum but the coupon errors out, and reinstalling the app does not help. Every case so far is Android.",
            severity: "high",
            owner: "Engineering",
          },
        },
      };
    },
  },

  // ---------------------------------------------------------------------
  {
    key: "coupon_tnc_gap",
    intent: "offer_not_applied",
    rootCause: "customer_expectation",
    weight: 5,
    build: ({ rng, order }) => ({
      turns: [
        A(pick(rng, GREETING)),
        C("Aapne SMS bheja tha 30% off ka, par cart mein lag nahi raha."),
        A("Main check karti hoon. Aapke cart mein kaunse items hain?"),
        C(`${order.items.slice(0, 2).join(" aur ")}. Total ${order.valueInr} rupaye.`),
        A(
          "Ji, ye offer sirf grocery aur home category pe valid hai, aur aapke cart mein ek personal care ka item hai jo exclusion list mein aata hai. Isliye coupon reject ho raha hai.",
        ),
        C("Ye to kahin likha hi nahi tha SMS mein."),
        A(
          "Aapki baat sahi hai, SMS mein sirf link tha. Main ye feedback marketing team ko de rahi hoon. Filhaal agar aap wo ek item hata dein to coupon lag jayega.",
        ),
        C("Theek hai, hata deta hoon."),
        A(pick(rng, CLOSE_BYE)),
      ],
      gt: {
        resolution: "info_provided",
        resolved: true,
        contained: true,
        sentimentStart: -0.25,
        sentimentEnd: 0.2,
        csatPredicted: 4,
        escalationRisk: 0.1,
        churnRisk: 0.12,
        refundRequested: false,
        rootCauseNote: "The campaign SMS did not carry the category exclusion, so the customer read the offer as unconditional.",
        nextBestAction:
          "Add the exclusion line to the campaign SMS template and show the reject reason inline in the cart instead of a generic error.",
        summary:
          "Coupon rejected because of a category exclusion the campaign SMS never mentioned. Agent explained and the customer adjusted the cart.",
        tags: ["coupon", "comms_gap"],
        policyFriction: ["Campaign SMS omits category exclusions"],
        quoteIdx: [{ i: 5, tag: "Expectation gap" }],
      },
    }),
  },

  // ---------------------------------------------------------------------
  {
    key: "payment_debited_no_order",
    intent: "payment_failed",
    rootCause: "payment_gateway",
    weight: 6,
    build: ({ rng, order, mood }) => ({
      turns: [
        A(pick(rng, GREETING)),
        C(`Mere account se ${order.valueInr} rupaye kat gaye hain lekin order place nahi hua. App pe kuch dikh hi nahi raha.`),
        A("Ye sunkar bura laga, main abhi dekhti hoon. Payment kis method se kiya tha — UPI ya card?"),
        C(pick(rng, ["UPI se, PhonePe.", "UPI kiya tha, Google Pay se.", "Card se, HDFC ka."])),
        A(pick(rng, HOLD)),
        A(
          "Main dekh rahi hoon ki transaction humare gateway tak pahunchi hi nahi, matlab wo bank ke level pe hold hai. Aise cases mein amount 24 se 48 ghante mein automatically wapas aa jaata hai.",
        ),
        C(
          mood === "angry"
            ? "Automatically wapas aa jaata hai matlab? Mere paise gaye kahan? Main confirm chahta hoon."
            : "Achha, aur agar nahi aaya to?",
        ),
        A(
          "Main aapke liye ek payment ticket raise kar rahi hoon reference ke saath. Agar 48 ghante mein credit nahi hua to hum bank ke saath directly follow up karenge, aapko kuch nahi karna padega.",
        ),
        C(mood === "angry" ? "Dekhta hoon, warna consumer forum jaana padega." : "Theek hai, thank you."),
        A(pick(rng, CLOSE_BYE)),
      ],
      gt: {
        resolution: "callback_promised",
        resolved: false,
        contained: true,
        sentimentStart: -0.6,
        sentimentEnd: mood === "angry" ? -0.4 : 0.05,
        csatPredicted: mood === "angry" ? 2 : 3,
        escalationRisk: mood === "angry" ? 0.7 : 0.3,
        churnRisk: mood === "angry" ? 0.5 : 0.22,
        refundRequested: true,
        refundAmountInr: order.valueInr,
        rootCauseNote:
          "Amount debited at bank level but the transaction never reached the gateway, leaving no order and no reconciliation the customer can see.",
        nextBestAction: "Surface pending-reversal transactions in the app order list so this stops being a phone call at all.",
        summary: "Money debited with no order created; the transaction stalled before the gateway. Ticket raised with a 48h auto-reversal window.",
        tags: ["payment", "trust"],
        quoteIdx: [{ i: 1, tag: "Debit without order" }],
      },
    }),
  },

  // ---------------------------------------------------------------------
  {
    key: "order_tracking_simple",
    intent: "order_tracking",
    rootCause: "customer_expectation",
    weight: 14,
    build: ({ rng, order }) => ({
      turns: [
        A(pick(rng, GREETING)),
        C(pick(rng, ["Bas ye jaanna tha ki mera order kahan tak pahuncha hai.", "Order ka status batayiye zara."])),
        A(pick(rng, HOLD)),
        A(pick(rng, VERIFY(order))),
        C("Haan ji."),
        A(
          `Aapka order ${order.hub} facility se dispatch ho chuka hai aur kal delivery ke liye out hoga. Aapko subah SMS mil jayega tracking link ke saath.`,
        ),
        C(pick(rng, ["Achha theek hai, thank you.", "Perfect, bas yahi jaanna tha."])),
        A(pick(rng, CLOSE_BYE)),
      ],
      gt: {
        resolution: "resolved_self_serve",
        resolved: true,
        contained: true,
        sentimentStart: 0.05,
        sentimentEnd: 0.5,
        csatPredicted: 5,
        escalationRisk: 0.03,
        churnRisk: 0.05,
        refundRequested: false,
        rootCauseNote: "Pure status check — the information already existed in the app but the customer called instead.",
        nextBestAction: "Deflectable: a proactive dispatch WhatsApp with the tracking link removes the call entirely.",
        summary: "Simple order status check, answered on the call in under a minute.",
        tags: ["deflectable", "low_effort"],
        quoteIdx: [{ i: 5, tag: "Status given" }],
      },
    }),
  },

  // ---------------------------------------------------------------------
  {
    key: "cancellation_late",
    intent: "cancellation",
    rootCause: "policy_friction",
    weight: 6,
    build: ({ rng, order, mood }) => ({
      turns: [
        A(pick(rng, GREETING)),
        C("Mujhe apna order cancel karna hai. App pe cancel ka option hi nahi dikh raha."),
        A(pick(rng, VERIFY(order))),
        C("Haan wahi. Abhi to kal hi order kiya tha."),
        A(
          "Main dekh rahi hoon ki aapka order pack ho chuka hai aur dispatch ho gaya hai, isliye app pe cancel ka option hat jaata hai. Ek baar dispatch hone ke baad hum ise refuse-on-delivery ke through wapas le sakte hain.",
        ),
        C(
          mood === "angry"
            ? "Ye kaisa system hai? 12 ghante mein hi dispatch bol rahe ho aur cancel nahi ho sakta?"
            : "Matlab mujhe delivery boy ko mana karna padega?",
        ),
        A(
          "Ji haan. Aap delivery ke time refuse kar dijiye, wo automatically return ho jayega aur full refund 5 se 7 working days mein aa jayega. Aapko kuch charge nahi lagega.",
        ),
        C(mood === "angry" ? "Itni jhanjhat. Theek hai." : "Chalo theek hai."),
        A(pick(rng, CLOSE_BYE)),
      ],
      gt: {
        resolution: "info_provided",
        resolved: true,
        contained: true,
        sentimentStart: -0.2,
        sentimentEnd: mood === "angry" ? -0.35 : 0.05,
        csatPredicted: mood === "angry" ? 2 : 3,
        escalationRisk: mood === "angry" ? 0.45 : 0.18,
        churnRisk: mood === "angry" ? 0.4 : 0.2,
        refundRequested: true,
        refundAmountInr: order.valueInr,
        rootCauseNote:
          "Cancellation window closes at dispatch, which can be under 12 hours, and the app gives no warning before the option disappears.",
        nextBestAction:
          "Show a countdown on the order page for the cancellation window, and allow in-app cancel-on-delivery instead of forcing a call.",
        summary: "Customer wanted to cancel after dispatch; app had already removed the option. Agent routed them to refuse-on-delivery.",
        tags: ["cancellation", "policy"],
        policyFriction: ["Cancellation window silently closes at dispatch", "Refuse-on-delivery is the only post-dispatch path and is not self-serve"],
        quoteIdx: [{ i: 5, tag: "Policy friction" }],
      },
    }),
  },

  // ---------------------------------------------------------------------
  {
    key: "quality_supplier",
    intent: "quality_complaint",
    rootCause: "supplier_quality",
    weight: 6,
    // Insects and off smells belong in food, not in detergent. Without this the
    // generator happily produces a quality complaint about dishwash bars.
    consumable: true,
    build: ({ rng, order, mood }) => {
      const item = order.items[0];
      const issue = pick(rng, [
        "andar keede nikle hain",
        "smell bahut ajeeb aa rahi hai, kharab lag raha hai",
        "expiry date nikal chuki hai, packet pe 2 mahine purani date hai",
      ]);
      return {
        turns: [
          A(pick(rng, GREETING)),
          C(`${item} mangwaya tha, usme ${issue}. Ye to health ka matter hai.`),
          A("Ye bilkul acceptable nahi hai, main bahut sorry hoon. Main abhi is batch ko flag kar rahi hoon."),
          A(pick(rng, VERIFY(order))),
          C("Haan. Aur packet pe batch number bhi likha hai, main bhej deta hoon."),
          A(
            "Bahut helpful hoga, please app pe photo aur batch number upload kar dijiye. Main full refund initiate kar rahi hoon aur quality team ko is batch ki jaanch ke liye bhej rahi hoon.",
          ),
          C(
            mood === "angry"
              ? "Refund se zyada important hai ki ye baaki logon ke paas na jaye."
              : "Theek hai, refund kar dijiye.",
          ),
          A("Bilkul sahi kaha. Main is batch pe hold request laga rahi hoon taaki aur customers tak na pahunche."),
          A(pick(rng, CLOSE_BYE)),
        ],
        gt: {
          resolution: "refund_initiated",
          resolved: true,
          contained: true,
          sentimentStart: -0.7,
          sentimentEnd: mood === "angry" ? -0.15 : 0.2,
          csatPredicted: 3,
          escalationRisk: 0.4,
          churnRisk: 0.35,
          refundRequested: true,
          refundAmountInr: order.valueInr,
          rootCauseNote: `Consumable SKU (${item}) reached the customer with a quality defect, pointing at supplier or storage rather than transit.`,
          nextBestAction: "Quarantine the batch, pull every order containing it, and reach out before those customers call in.",
          summary: `${item} arrived with a quality defect (${issue}). Full refund issued and batch flagged for quarantine.`,
          tags: ["quality", "batch_risk", "food_safety"],
          quoteIdx: [
            { i: 1, tag: "Quality defect" },
            { i: 6, tag: "Customer flags wider risk" },
          ],
          productSignal: {
            title: "Consumable batch reaching customers with quality defects",
            evidence: `Customer reports ${issue} in ${item}, with a batch number available for traceback.`,
            severity: "high",
            owner: "Category / QC",
          },
        },
      };
    },
  },

  // ---------------------------------------------------------------------
  {
    key: "return_pickup_missed",
    intent: "return_pickup",
    rootCause: "logistics_3pl",
    weight: 7,
    build: ({ rng, order, mood }) => {
      const attempts = intBetween(rng, 2, 3);
      return {
        turns: [
          A(pick(rng, GREETING)),
          C(`Return pickup ${attempts} baar schedule ho chuka hai par koi aaya hi nahi. Har baar SMS aata hai ki attempt fail.`),
          A(pick(rng, HOLD)),
          A(pick(rng, VERIFY(order))),
          C("Haan. Main ghar pe hi tha dono baar, kisi ne call tak nahi kiya."),
          A(
            "Main dekh rahi hoon ki system mein customer-not-available mark hua hai, jo aapke hisaab se galat hai. Main is pickup ko dobara schedule kar rahi hoon aur delivery partner ko note bhej rahi hoon.",
          ),
          C(
            mood === "angry"
              ? "Jab tak pickup nahi hoga, refund bhi nahi milega na? Ye loop kab tak chalega?"
              : "Aur refund kab tak aayega?",
          ),
          A(
            "Aapki baat sahi hai. Main aapke case mein refund pickup se pehle hi release kara rahi hoon, taaki aapko wait na karna pade. Pickup hum apni taraf se follow up kar lenge.",
          ),
          C(pick(rng, ["Achha, ye theek hai.", "Chalo, thank you."])),
          A(pick(rng, CLOSE_BYE)),
        ],
        gt: {
          resolution: "pickup_scheduled",
          resolved: true,
          contained: true,
          sentimentStart: -0.5,
          sentimentEnd: 0.25,
          csatPredicted: mood === "angry" ? 3 : 4,
          escalationRisk: 0.3,
          churnRisk: 0.28,
          refundRequested: true,
          refundAmountInr: order.valueInr,
          repeatCaller: true,
          rootCauseNote: `Pickup marked customer-not-available ${attempts} times while the customer was home — a false disposition by the 3PL rider.`,
          nextBestAction:
            "Audit false not-available dispositions by rider; require a call log or geotag before a failed-attempt status can be set.",
          summary: `Return pickup failed ${attempts} times with false not-available codes. Agent rescheduled and released the refund early.`,
          tags: ["false_disposition", "3pl", "repeat_contact"],
          policyFriction: ["Refund is gated on pickup completion, so a 3PL failure holds the customer money hostage"],
          quoteIdx: [
            { i: 1, tag: "Repeated failed pickups" },
            { i: 4, tag: "Contradicts rider disposition" },
          ],
          productSignal: {
            title: "Riders marking pickups customer-not-available without contact",
            evidence: `Customer was home for ${attempts === 2 ? "both" : `all ${attempts}`} attempts and received no call, yet each was dispositioned not-available.`,
            severity: "medium",
            owner: "Ops — Last mile",
          },
        },
      };
    },
  },

  // ---------------------------------------------------------------------
  {
    key: "subscription_stockout",
    intent: "subscription_manage",
    rootCause: "inventory_stockout",
    weight: 5,
    build: ({ rng, order, mood }) => ({
      turns: [
        A(pick(rng, GREETING)),
        C("Meri daily milk subscription hai, par pichhle teen din se delivery nahi aa rahi. Paisa to kat raha hai."),
        A(pick(rng, HOLD)),
        A(
          "Main dekh rahi hoon ki aapke area ke liye wo variant stock out chal raha hai, isliye delivery skip ho rahi hai. Aapke skipped days ka charge automatically wallet mein wapas aata hai, main confirm kar leti hoon.",
        ),
        C(
          mood === "angry"
            ? "Mujhe koi notification hi nahi mila ki stock nahi hai. Subah dudh ka intezaar karta raha main."
            : "Achha, mujhe pata hi nahi tha.",
        ),
        A(
          "Aap bilkul sahi hain, aapko pehle inform hona chahiye tha. Main do cheezein kar rahi hoon: teen din ka amount aapke wallet mein credit, aur aapki subscription ko available variant pe switch kar deti hoon agar aap kahein.",
        ),
        C(pick(rng, ["Haan switch kar do.", "Theek hai, switch kar dijiye."])),
        A("Ho gaya. Kal subah se normal delivery shuru ho jayegi."),
        A(pick(rng, CLOSE_BYE)),
      ],
      gt: {
        resolution: "resolved_self_serve",
        resolved: true,
        contained: true,
        sentimentStart: -0.45,
        sentimentEnd: 0.35,
        csatPredicted: 4,
        escalationRisk: 0.15,
        churnRisk: mood === "angry" ? 0.35 : 0.18,
        refundRequested: false,
        rootCauseNote:
          "Subscription silently skipped for three days due to a variant stockout, with no proactive notification to the subscriber.",
        nextBestAction:
          "Notify subscribers the night before a skip and offer a one-tap variant swap — a silent skip on a daily essential is a churn event.",
        summary: "Daily subscription silently skipped for three days due to a stockout. Wallet credit issued and variant switched on call.",
        tags: ["subscription", "silent_failure", "churn_risk"],
        quoteIdx: [{ i: 4, tag: "No proactive notification" }],
        productSignal: {
          title: "Subscription skips are silent",
          evidence: "Subscriber waited three mornings for a delivery that was auto-skipped for a stockout, with no notification sent.",
          severity: "medium",
          owner: "Product / Policy",
        },
      },
    }),
  },

  // ---------------------------------------------------------------------
  {
    key: "address_change",
    intent: "address_change",
    rootCause: "customer_expectation",
    weight: 5,
    build: ({ rng, order }) => ({
      turns: [
        A(pick(rng, GREETING)),
        C("Mujhe delivery address change karna hai, main naye ghar shift ho gaya hoon."),
        A(pick(rng, VERIFY(order))),
        C("Haan, wahi order. Abhi tak dispatch nahi hua na?"),
        A(
          "Nahi, abhi packing stage mein hai to main address update kar sakti hoon. Aap naya address aur pincode bata dijiye.",
        ),
        C(pick(rng, ["Haan likhiye, flat number bhi note kar lijiye.", "Ji, main bata deta hoon."])),
        A("Note kar liya. Address update ho gaya hai, aur aapko confirmation SMS bhej diya hai. Delivery date same rahegi."),
        C(pick(rng, ["Great, thank you.", "Perfect, thanks."])),
        A(pick(rng, CLOSE_BYE)),
      ],
      gt: {
        resolution: "resolved_self_serve",
        resolved: true,
        contained: true,
        sentimentStart: 0.1,
        sentimentEnd: 0.6,
        csatPredicted: 5,
        escalationRisk: 0.03,
        churnRisk: 0.04,
        refundRequested: false,
        rootCauseNote: "Address edit is not self-serve after order placement, so a routine change becomes a support call.",
        nextBestAction: "Allow in-app address edit until dispatch; this is a pure deflection opportunity with no policy risk.",
        summary: "Pre-dispatch address change, handled fully on the call.",
        tags: ["deflectable", "self_serve_gap"],
        quoteIdx: [{ i: 1, tag: "Self-serve gap" }],
      },
    }),
  },

  // ---------------------------------------------------------------------
  // English-first callers. Kept as separate scenarios rather than translating
  // the Hinglish ones, because the register really is different: shorter turns,
  // more direct escalation, explicit references to written policy.
  {
    key: "delivery_delay_english",
    intent: "delivery_delay",
    rootCause: "logistics_3pl",
    weight: 5,
    cityBias: { Bengaluru: 1.8, Mumbai: 1.4, "Delhi NCR": 1.3 },
    build: ({ rng, order, mood, days }) => ({
      turns: [
        A("Good evening, this is Maya from Kartly support. How can I help you today?"),
        C(
          mood === "angry"
            ? "Yes, my order is three days past the promised date and the tracking has not moved at all. This is the second time this month."
            : "Hi, I wanted to check on an order that has not arrived yet. It was due two days ago.",
        ),
        A("I am sorry about that. Let me pull up the order right away."),
        A(`I have order ${order.id} placed on ${order.placedShort}, total ${order.valueInr} rupees. Is that the one?`),
        C("That is correct."),
        A(
          `I can see the parcel reached our ${order.hub} hub but there has been no scan for ${days} days. That is a delay on the courier side and I am sorry you had to chase us for it.`,
        ),
        C(
          mood === "angry"
            ? "I would like to know what you are actually going to do about it, not just an apology."
            : "Alright, when can I expect it?",
        ),
        A(
          "Two things. I am raising a priority trace with the courier which forces a response within 24 hours, and I am setting an automatic alert so you get an SMS the moment it moves, without having to call us.",
        ),
        C(mood === "angry" ? "Fine. If it does not move by tomorrow I want a full refund." : "That works, thank you."),
        A(
          mood === "angry"
            ? "That is completely fair. I have noted a refund pre-approval on this order, so if there is no movement by tomorrow evening it can be processed without you explaining this again."
            : "Happy to help. Thank you for choosing Kartly.",
        ),
      ],
      gt: {
        resolution: "info_provided",
        resolved: false,
        contained: true,
        sentimentStart: mood === "angry" ? -0.65 : -0.3,
        sentimentEnd: mood === "angry" ? -0.15 : 0.25,
        csatPredicted: mood === "angry" ? 3 : 4,
        escalationRisk: mood === "angry" ? 0.55 : 0.25,
        churnRisk: mood === "angry" ? 0.42 : 0.18,
        refundRequested: mood === "angry",
        refundAmountInr: mood === "angry" ? order.valueInr : 0,
        rootCauseNote: `No courier scan for ${days} days after arrival at the ${order.hub} hub.`,
        nextBestAction:
          "Pre-approve the refund at SLA breach rather than at the second call — the customer should not have to ask twice.",
        summary: `English-speaking customer chased a delayed order stalled at ${order.hub}. Priority trace raised and refund pre-approved.`,
        tags: ["sla_breach", "3pl"],
        quoteIdx: [{ i: 5, tag: "SLA breach evidence" }],
      },
    }),
  },

  // ---------------------------------------------------------------------
  {
    key: "coupon_app_bug_english",
    intent: "offer_not_applied",
    rootCause: "app_bug",
    weight: 1.2,
    build: ({ rng, order }) => {
      const disc = Math.round(order.valueInr * 0.3);
      return {
        turns: [
          A("Good morning, Maya from Kartly support. How can I help?"),
          C("The MONSOON30 code is not applying. I get a generic error every time, and my cart is well over the minimum."),
          A("Let me check that. What is the cart value, and which device are you on?"),
          C(`Around ${order.valueInr} rupees, and I am on an Android phone. My wife tried the same code on her iPhone and it worked fine.`),
          A("That is a very useful detail, thank you. Let me confirm something on my side."),
          A(
            `You are right that the cart qualifies. I am applying the ${disc} rupee discount to your account manually so you are not blocked, and I am raising this with our engineering team as a device-specific issue.`,
          ),
          C("Please do. It is a bit odd that a promotion you are actively texting people about does not work on half the phones."),
          A(
            "That is a fair point and I am putting exactly that in the report. The credit is on your account now, you can place the order whenever you like.",
          ),
          C("Thank you."),
          A("Thank you for flagging it. Have a good day."),
        ],
        gt: {
          resolution: "resolved_self_serve",
          resolved: true,
          contained: true,
          sentimentStart: -0.3,
          sentimentEnd: 0.35,
          csatPredicted: 4,
          escalationRisk: 0.15,
          churnRisk: 0.2,
          refundRequested: false,
          rootCauseNote:
            "Same coupon succeeds on iOS and fails on Android for an identical qualifying cart — an Android client validation bug, confirmed by the customer side-by-side.",
          nextBestAction:
            "This call contains the cleanest repro on record: same cart, iOS passes, Android fails. Attach it to the P1 ticket.",
          summary:
            "MONSOON30 failed on Android while succeeding on iOS for the same cart. Discount applied manually; strong repro captured for engineering.",
          tags: ["coupon", "android", "checkout_blocker", "clean_repro"],
          quoteIdx: [
            { i: 3, tag: "Cross-platform repro" },
            { i: 6, tag: "Brand damage" },
          ],
          productSignal: {
            title: "MONSOON30 silently fails on Android at checkout",
            evidence: "Identical cart succeeds on iOS and fails on Android, reported side by side by the same household.",
            severity: "high",
            owner: "Engineering",
          },
        },
      };
    },
  },

  // ---------------------------------------------------------------------
  {
    key: "feedback_positive",
    intent: "feedback_positive",
    rootCause: "customer_expectation",
    weight: 5,
    outbound: true,
    build: ({ rng, order }) => ({
      turns: [
        A(
          "Namaste, main Maya bol rahi hoon Kartly se. Aapka kal ka order deliver ho gaya tha, bas ek minute ka feedback lena tha. Theek rahega?",
        ),
        C(pick(rng, ["Haan bilkul, boliye.", "Ji, poochiye."])),
        A("Delivery time aur packaging se aap kitne satisfied the, 1 se 5 mein?"),
        C(pick(rng, ["5 doonga, time se pehle hi aa gaya tha.", "4-5, sab theek tha. Delivery boy bhi polite tha."])),
        A("Sunkar bahut achha laga. Koi cheez jo hum behtar kar sakte hain?"),
        C(
          pick(rng, [
            "Bas fruits ki quality thodi aur achhi ho sakti hai, baaki sab badhiya hai.",
            "App mein order history dhoondhne mein thoda time lagta hai, wo simple kar dijiye.",
            "Kuch khaas nahi, aap log theek chala rahe ho.",
          ]),
        ),
        A("Ye note kar liya maine, product team tak pahuncha dungi. Aapke time ke liye dhanyavaad."),
        A(pick(rng, CLOSE_BYE)),
      ],
      gt: {
        resolution: "info_provided",
        resolved: true,
        contained: true,
        sentimentStart: 0.4,
        sentimentEnd: 0.7,
        csatPredicted: 5,
        escalationRisk: 0.02,
        churnRisk: 0.03,
        refundRequested: false,
        rootCauseNote: "Outbound CSAT call — no issue raised, one minor improvement suggestion captured.",
        nextBestAction: "Route the improvement suggestion into the product backlog with the call as evidence.",
        summary: "Outbound feedback call. Customer satisfied, gave one small improvement suggestion.",
        tags: ["outbound", "csat", "voice_of_customer"],
        quoteIdx: [{ i: 5, tag: "Improvement suggestion" }],
      },
    }),
  },
];
