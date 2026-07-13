/**
 * VitaScan EvoMetaClaw SDK v1.0
 * Reusable JavaScript SDK for FMCG QR/Barcode health & sustainability analysis.
 *
 * Usage (browser):
 *   <script src="sdk/vitascan-sdk.js"></script>
 *   const result = await VitaScanSDK.analyzeBarcode('5449000000996');
 *
 * Usage (module):
 *   import VitaScanSDK from './sdk/vitascan-sdk.js';
 *
 * @author EvoMetaClaw Evolution
 * @license MIT
 */

const VitaScanSDK = (() => {
  const OPEN_FOOD_FACTS_API = 'https://world.openfoodfacts.org/api/v0/product/';

  /**
   * Fetch product data from Open Food Facts by barcode
   * @param {string} barcode - 8 to 14 digit barcode
   * @returns {Promise<Object|null>} Product data or null
   */
  async function fetchProduct(barcode) {
    if (!/^\d{8,14}$/.test(barcode)) {
      throw new Error('Invalid barcode format');
    }
    try {
      const res = await fetch(`${OPEN_FOOD_FACTS_API}${barcode}.json`);
      const data = await res.json();
      return data.status === 1 ? data.product : null;
    } catch (e) {
      console.warn('[VitaScanSDK] OFF fetch failed, returning null');
      return null;
    }
  }

  /**
   * Load user evolution model from localStorage (EvoMetaClaw self-evolving flywheel)
   * Accumulates trajectory data from feedback -> personal model adapts without central server.
   */
  function loadUserEvolution() {
    try {
      return JSON.parse(localStorage.getItem('vitascan_user_evolution') || '{}');
    } catch (e) {
      return {};
    }
  }

  /**
   * Record feedback to evolve the personal model (the strategic moat).
   * @param {Object} feedback - e.g. { type: 'recommendation_helpful' | 'score_too_low' | 'sugar_sensitive', value: 1 | -1, context: {} }
   */
  function recordFeedback(feedback = {}) {
    let model = loadUserEvolution();
    model.feedbackCount = (model.feedbackCount || 0) + 1;
    model.lastUpdated = new Date().toISOString();

    // Simple adaptive weights (EvoMetaClaw flywheel - accumulates data locally)
    if (!model.sugarMultiplier) model.sugarMultiplier = 1.0;
    if (!model.proteinMultiplier) model.proteinMultiplier = 1.0;
    if (!model.overallBias) model.overallBias = 0;

    const val = feedback.value || 0;

    if (feedback.type === 'recommendation_helpful' || feedback.type === 'accurate') {
      model.overallBias = Math.max(-5, Math.min(5, (model.overallBias || 0) + val * 0.3));
    }
    if (feedback.type === 'sugar_too_penalized' || (feedback.context && feedback.context.highSugar)) {
      model.sugarMultiplier = Math.max(0.5, Math.min(2.0, model.sugarMultiplier + val * 0.1));
    }
    if (feedback.type === 'protein_under_rewarded') {
      model.proteinMultiplier = Math.max(0.5, Math.min(2.0, model.proteinMultiplier + val * 0.1));
    }

    localStorage.setItem('vitascan_user_evolution', JSON.stringify(model));
    return model;
  }

  /**
   * Calculate custom VitaScore (0-100) with EvoMetaClaw self-evolution
   * @param {Object} product 
   * @param {Object} [profile={}] 
   * @returns {number} VitaScore
   */
  function calculateVitaScore(product, profile = {}) {
    if (product._demoScore) return product._demoScore;

    const n = product.nutriments || {};
    let score = 65;

    // Base nutrition
    const protein = n["proteins_100g"] || 0;
    const fiber = n["fiber_100g"] || 0;
    score += Math.min(15, protein * 1.8);
    score += Math.min(12, fiber * 2.5);

    const sugar = n["sugars_100g"] || 0;
    const satFat = n["saturated-fat_100g"] || 0;
    const sodium = (n["sodium_100g"] || 0) * 1000;
    const energy = n["energy-kcal_100g"] || 0;

    if (sugar > 5) score -= (sugar - 5) * 1.8;
    if (satFat > 3) score -= (satFat - 3) * 3.2;
    if (sodium > 300) score -= (sodium - 300) / 40;
    if (energy > 350) score -= (energy - 350) / 12;

    // Processing
    const nova = product.nova_group || 3;
    if (nova === 4) score -= 18;
    else if (nova === 3) score -= 8;

    // Additives
    const additives = product.additives_tags || [];
    score -= Math.min(12, additives.length * 3);

    // === Personalization (EvoMetaClaw E + Im) ===
    if (profile.goal === 'blood_sugar' || profile.diabetic) {
      score -= sugar * 2.5;
    }
    if (profile.goal === 'athletic' || profile.athlete) {
      score += protein * 1.2;
    }
    if (profile.goal === 'weight_loss') {
      if (energy > 300) score -= 8;
      if (fiber > 6) score += 6;
    }

    // === Self-evolving user model (the flywheel moat) ===
    const evolution = loadUserEvolution();
    const sugarMult = evolution.sugarMultiplier || 1.0;
    const proteinMult = evolution.proteinMultiplier || 1.0;
    const bias = evolution.overallBias || 0;

    // Apply evolved multipliers (adapts from user feedback trajectory data)
    if (sugar > 5) score -= (sugar - 5) * 1.8 * (sugarMult - 0.5); // dynamic sensitivity
    score += bias; // overall learned bias

    // Eco / Citizen Score (new low-hanging for commercial + citizen value)
    let ecoScore = 75;
    ecoScore -= (nova - 1) * 12;
    ecoScore -= additives.length * 4;
    if (product.ingredients_analysis_tags && product.ingredients_analysis_tags.includes('en:contains-palm-oil')) ecoScore -= 10;
    ecoScore += Math.min(10, fiber * 1.5);
    ecoScore = Math.max(20, Math.min(95, Math.round(ecoScore)));

    return {
      health: Math.max(5, Math.min(98, Math.round(score))),
      eco: ecoScore
    };
  }

  /**
   * Get personalized recommendations
   */
  function getRecommendations(product, profile = {}) {
    const scores = calculateVitaScore(product, profile);
    const score = typeof scores === 'object' ? scores.health : scores;
    const recs = [];
    const n = product.nutriments || {};
    const sugar = n["sugars_100g"] || 0;
    const nova = product.nova_group || 3;

    if (score < 45) {
      recs.push("Consider as occasional treat. Look for lower-sugar or minimally-processed alternatives.");
    } else if (score < 70) {
      recs.push("Decent option in moderation. Pair with whole foods.");
    } else {
      recs.push("Great choice for regular consumption.");
    }

    if (sugar > 8) {
      recs.push(profile.diabetic || profile.goal === 'blood_sugar' 
        ? "High sugar — strictly limit or avoid if managing blood glucose." 
        : "High in added sugars — watch portions.");
    }

    if (nova === 4) {
      recs.push("Ultra-processed. Homemade version recommended when possible.");
    }

    if ((n["proteins_100g"] || 0) > 10) {
      recs.push("Good protein content — supports satiety and muscle health.");
    }

    recs.push("Always verify full ingredients and serving size on the physical package.");

    return recs;
  }

  /**
   * Get Eco/Citizen Score (standalone for sustainability focus)
   */
  function calculateEcoScore(product) {
    const scores = calculateVitaScore(product, {});
    return typeof scores === 'object' ? scores.eco : 70;
  }

  /**
   * Analyze a product by barcode (main SDK method)
   * @param {string} barcode 
   * @param {Object} [profile]
   * @returns {Promise<Object>} Structured analysis result
   */
  async function analyzeBarcode(barcode, profile = {}) {
    const product = await fetchProduct(barcode);
    if (!product) {
      return { error: "Product not found", barcode };
    }

    const score = calculateVitaScore(product, profile);
    const recommendations = getRecommendations(product, profile);

    return {
      product,
      vitaScore: score,
      nutriscore: product.nutriscore_grade?.toUpperCase() || 'N/A',
      novaGroup: product.nova_group,
      recommendations,
      profileUsed: Object.keys(profile).length > 0 ? profile : null,
      source: "Open Food Facts + EvoMetaClaw SDK",
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Simple QR/Barcode scanner helper (uses browser camera + jsQR if available)
   * For full camera scanning, the main PWA app is recommended.
   */
  async function scanWithCamera(videoElement, onResult) {
    // This is a lightweight helper. Full implementation lives in the PWA.
    console.warn('[VitaScanSDK] scanWithCamera is a stub. Use the full PWA for production scanning.');
    // In real SDK this would wrap getUserMedia + jsQR
    return { success: false, message: "Use VitaScan PWA for full camera QR scanning" };
  }

  /**
   * Record feedback to evolve the personal model (the strategic moat).
   * Exposed for commercial apps to collect user signals.
   */
  function recordFeedback(feedback = {}) {
    let model = loadUserEvolution();
    model.feedbackCount = (model.feedbackCount || 0) + 1;
    model.lastUpdated = new Date().toISOString();

    if (!model.sugarMultiplier) model.sugarMultiplier = 1.0;
    if (!model.proteinMultiplier) model.proteinMultiplier = 1.0;
    if (!model.overallBias) model.overallBias = 0;

    const val = feedback.value || 0;

    if (feedback.type === 'recommendation_helpful' || feedback.type === 'accurate') {
      model.overallBias = Math.max(-5, Math.min(5, (model.overallBias || 0) + val * 0.3));
    }
    if (feedback.type === 'sugar_too_penalized' || (feedback.context && feedback.context.highSugar)) {
      model.sugarMultiplier = Math.max(0.5, Math.min(2.0, model.sugarMultiplier + val * 0.1));
    }
    if (feedback.type === 'protein_under_rewarded') {
      model.proteinMultiplier = Math.max(0.5, Math.min(2.0, model.proteinMultiplier + val * 0.1));
    }

    localStorage.setItem('vitascan_user_evolution', JSON.stringify(model));
    return model;
  }

  /**
   * Generate embed code for commercial websites (key low-hanging fruit for integration)
   * Returns ready-to-paste HTML for product pages, emails, ads. Boosts engagement & trust.
   */
  function generateEmbedCode(productName = 'Product', healthScore = 75, ecoScore = 70) {
    const safeName = String(productName).replace(/"/g, '&quot;');
    return `<!-- VitaScan EvoMetaClaw Commercial Embed Badge -->
<div class="vitascan-embed" style="max-width: 320px; font-family: system-ui, -apple-system, sans-serif; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); background: #fff;">
  <div style="padding: 20px;">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
      <div>
        <div style="font-size: 15px; font-weight: 700; color: #111827; line-height: 1.2;">${safeName}</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Health • Sustainability Score</div>
      </div>
      <div style="text-align: right; min-width: 60px;">
        <div style="font-size: 32px; font-weight: 800; line-height: 1; color: #10b981;">${healthScore}</div>
        <div style="font-size: 11px; color: #64748b; font-weight: 500;">Health</div>
      </div>
    </div>
    <div style="margin-bottom: 16px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <div style="flex: 1; height: 8px; background: #e2e8f0; border-radius: 9999px; overflow: hidden;">
          <div style="width: ${healthScore}%; height: 100%; background: linear-gradient(90deg, #10b981, #34d399); border-radius: 9999px;"></div>
        </div>
        <div style="font-size: 13px; font-weight: 600; color: #10b981; min-width: 36px; text-align: right;">${healthScore}</div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <div style="flex: 1; height: 8px; background: #e2e8f0; border-radius: 9999px; overflow: hidden;">
          <div style="width: ${ecoScore}%; height: 100%; background: linear-gradient(90deg, #14b8a6, #5eead4); border-radius: 9999px;"></div>
        </div>
        <div style="font-size: 13px; font-weight: 600; color: #14b8a6; min-width: 36px; text-align: right;">${ecoScore}</div>
      </div>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 12px; color: #64748b;">
      <div>🌍 Eco ${ecoScore}</div>
      <div style="font-weight: 500; color: #10b981;">EvoMetaClaw</div>
    </div>
  </div>
  <div style="background: #f8fafc; padding: 10px 20px; font-size: 10px; color: #64748b; text-align: center; border-top: 1px solid #e5e7eb;">
    Self-evolving scores • Powered by <a href="https://github.com/dnzengou/vitascan" target="_blank" style="color: #10b981; text-decoration: none; font-weight: 500;">VitaScan</a>
  </div>
</div>`;
  }

  /**
   * Compare two products - perfect for e-commerce comparison features, recommendation engines, A/B marketing tests
   */
  function compareProducts(productA, productB, profile = {}) {
    const scoresA = calculateVitaScore(productA, profile);
    const scoresB = calculateVitaScore(productB, profile);
    const healthA = typeof scoresA === 'object' ? scoresA.health : scoresA;
    const healthB = typeof scoresB === 'object' ? scoresB.health : scoresB;
    const ecoA = typeof scoresA === 'object' ? scoresA.eco : 70;
    const ecoB = typeof scoresB === 'object' ? scoresB.eco : 70;

    const healthWinner = healthA > healthB ? 'A' : (healthB > healthA ? 'B' : 'Tie');
    const ecoWinner = ecoA > ecoB ? 'A' : (ecoB > ecoA ? 'B' : 'Tie');

    return {
      productA: { name: productA.product_name || 'Product A', health: healthA, eco: ecoA },
      productB: { name: productB.product_name || 'Product B', health: healthB, eco: ecoB },
      healthWinner,
      ecoWinner,
      recommendation: healthA >= healthB 
        ? `Recommend ${productA.product_name || 'Product A'} for superior health impact.` 
        : `Recommend ${productB.product_name || 'Product B'} for superior health impact.`,
      commercialNote: 'Ideal for side-by-side product pages, smart carts, or personalized shopping experiences. The EvoMetaClaw self-evolution creates unique per-user models that competitors cannot easily replicate.'
    };
  }

  /**
   * Get business/commercial insights for a product - high-value for brands, retailers & marketers
   * Helps with positioning, campaigns, and demonstrates the unique EvoMetaClaw moat.
   */
  function getBusinessInsights(product) {
    const scores = calculateVitaScore(product, {});
    const health = typeof scores === 'object' ? scores.health : 65;
    const eco = typeof scores === 'object' ? scores.eco : 70;

    const insights = [];
    if (health > 80) {
      insights.push('Premium health positioning: Perfect for wellness marketing, health claims, and targeting health-conscious demographics.');
    } else if (health > 60) {
      insights.push('Reliable everyday option: Strong for mass-market products; emphasize balanced nutrition in campaigns.');
    } else {
      insights.push('Reformulation opportunity: Highlight path to improvement to build brand trust and loyalty.');
    }

    if (eco > 80) {
      insights.push('Sustainability leader: Excellent for ESG storytelling, eco-labels, and attracting conscious consumers.');
    } else if (eco > 60) {
      insights.push('Sustainability potential: Good base for incremental improvements in sourcing/packaging messaging.');
    }

    if (product.nova_group && product.nova_group <= 2) {
      insights.push('Clean & minimally processed: Aligns with clean-label trends; leverage in "natural" and "whole ingredient" campaigns.');
    }

    insights.push('Unique moat: Self-evolving personalization via user feedback creates proprietary trajectory data no competitor can copy without rebuilding the entire paradigm.');

    return {
      healthScore: health,
      ecoScore: eco,
      insights,
      commercialValue: 'Embed scores on product pages to boost conversions (studies show health/sustainability labels increase purchase intent). Use in retailer dashboards or brand portals for data-driven decisions.',
      suggestedUse: 'E-commerce product detail pages, comparison tools, email marketing, in-store apps, or white-label solutions for chains.'
    };
  }

  // === White-label / Branding Support (new for commercial white-label deployments) ===
  let brandingConfig = {
    primaryColor: '#10b981',
    accentColor: '#14b8a6',
    appName: 'VitaScan EvoMetaClaw',
    logoUrl: '',
    companyName: '',
    footerText: 'Self-evolving • Open data'
  };

  function setBranding(config = {}) {
    brandingConfig = { ...brandingConfig, ...config };
    // Apply to document if in browser (for PWA white-label)
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (brandingConfig.primaryColor) root.style.setProperty('--primary', brandingConfig.primaryColor);
    }
    return { ...brandingConfig };
  }

  function getBranding() {
    return { ...brandingConfig };
  }

  // Update generateEmbedCode to support branding
  // (re-defined here for completeness with branding support)
  function generateEmbedCode(productName = 'Product', healthScore = 75, ecoScore = 70, branding = {}) {
    const b = { ...brandingConfig, ...branding };
    const safeName = String(productName).replace(/"/g, '&quot;');
    const primary = b.primaryColor || '#10b981';
    const accent = b.accentColor || '#14b8a6';
    return `<!-- VitaScan EvoMetaClaw White-Label Commercial Embed -->
<div class="vitascan-embed" style="max-width: 320px; font-family: system-ui, -apple-system, sans-serif; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); background: #fff;">
  <div style="padding: 20px;">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
      <div>
        <div style="font-size: 15px; font-weight: 700; color: #111827; line-height: 1.2;">${safeName}</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Health • Sustainability Score</div>
      </div>
      <div style="text-align: right; min-width: 60px;">
        <div style="font-size: 32px; font-weight: 800; line-height: 1; color: ${primary};">${healthScore}</div>
        <div style="font-size: 11px; color: #64748b; font-weight: 500;">Health</div>
      </div>
    </div>
    <div style="margin-bottom: 16px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <div style="flex: 1; height: 8px; background: #e2e8f0; border-radius: 9999px; overflow: hidden;">
          <div style="width: ${healthScore}%; height: 100%; background: linear-gradient(90deg, ${primary}, ${accent}); border-radius: 9999px;"></div>
        </div>
        <div style="font-size: 13px; font-weight: 600; color: ${primary}; min-width: 36px; text-align: right;">${healthScore}</div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <div style="flex: 1; height: 8px; background: #e2e8f0; border-radius: 9999px; overflow: hidden;">
          <div style="width: ${ecoScore}%; height: 100%; background: linear-gradient(90deg, ${accent}, #5eead4); border-radius: 9999px;"></div>
        </div>
        <div style="font-size: 13px; font-weight: 600; color: ${accent}; min-width: 36px; text-align: right;">${ecoScore}</div>
      </div>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 12px; color: #64748b;">
      <div>🌍 Eco ${ecoScore}</div>
      <div style="font-weight: 500; color: ${primary};">${b.appName}</div>
    </div>
  </div>
  <div style="background: #f8fafc; padding: 10px 20px; font-size: 10px; color: #64748b; text-align: center; border-top: 1px solid #e5e7eb;">
    ${b.footerText} • <a href="https://github.com/dnzengou/vitascan" target="_blank" style="color: ${primary}; text-decoration: none; font-weight: 500;">Powered by VitaScan</a>
  </div>
</div>`;
  }

  // Public API
  return {
    analyzeBarcode,
    calculateVitaScore,
    getRecommendations,
    fetchProduct,
    scanWithCamera,
    recordFeedback,
    generateEmbedCode,
    compareProducts,
    getBusinessInsights,
    calculateEcoScore,
    setBranding,
    getBranding,
    version: "1.1.0-evo-metaclaw-commercial"
  };
})();

// UMD / Global export for <script> tag usage
if (typeof window !== 'undefined') {
  window.VitaScanSDK = VitaScanSDK;
}

// ES Module export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VitaScanSDK;
}

export default VitaScanSDK;