const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ─── Infos candidat ───────────────────────────────────────────────
const CANDIDAT = {
  prenom: 'Ness',
  nom: 'Taourirt',
  email: 'ness.taourirt@gmail.com',
  telephone: '0659356402',
  cvUrl: 'https://drive.google.com/uc?export=download&id=1zeAvLMOQYNckIsdbHdLmdnF9Fuj_4n0J',
  cvPath: '/tmp/cv_ness_taourirt.pdf',
};

// ─── Télécharge le CV au démarrage ────────────────────────────────
async function downloadCV() {
  if (fs.existsSync(CANDIDAT.cvPath)) {
    console.log('CV déjà présent.');
    return;
  }
  console.log('Téléchargement du CV...');
  const response = await axios({ url: CANDIDAT.cvUrl, method: 'GET', responseType: 'stream' });
  const writer = fs.createWriteStream(CANDIDAT.cvPath);
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', () => { console.log('CV téléchargé ✓'); resolve(); });
    writer.on('error', reject);
  });
}

// ─── Délai humain aléatoire ────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const humanDelay = () => sleep(800 + Math.random() * 1200);

// ─── Déduplication des candidatures (par session) ─────────────────
const jobsAlreadyApplied = new Set();

// ─── Résoudre les URLs de tracking HelloWork ──────────────────────
function resolveHelloWorkUrl(trackingUrl) {
  try {
    const parts = trackingUrl.split('/');
    const b64Token = parts[parts.length - 1];
    const padded = b64Token + '=='.slice(0, (4 - b64Token.length % 4) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    const urlMatch = decoded.match(/https:\/\/www\.hellowork\.com\/fr-fr\/emplois\/[^\s?&"<>]+\.html/);
    if (urlMatch) return urlMatch[0];
  } catch (e) {
    console.log(`Impossible de décoder l'URL de tracking: ${e.message}`);
  }
  return trackingUrl;
}

// ─── Extraire l'ID de job depuis l'URL ────────────────────────────
function extractJobId(url) {
  const match = url.match(/\/(\d+)\.html/);
  return match ? match[1] : null;
}

// ─── Logique de postulation HelloWork ─────────────────────────────
async function applyHelloWork(jobUrl, coverLetter) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,800',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  try {
    console.log(`Navigation vers : ${jobUrl}`);
    await page.goto(jobUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await humanDelay();

    // ── Fermer les popups cookies si présents ──────────────────────
    try {
      const cookieBtn = await page.$('button#didomi-notice-agree-button, button[id*="accept"], button[class*="cookie-accept"]');
      if (cookieBtn) { await cookieBtn.click(); await sleep(500); }
    } catch (_) {}

    // ── Trouver et cliquer le bouton Postuler ──────────────────────
    const postulerSelectors = [
      'a[data-testid="apply-button"]',
      'button[data-testid="apply-button"]',
      'a.btn-postuler',
      'button.btn-postuler',
      'a[class*="ApplyButton"]',
      'button[class*="ApplyButton"]',
      'a[href*="postuler"]',
      '[class*="postuler" i]',
    ];

    let postulerBtn = null;
    for (const sel of postulerSelectors) {
      postulerBtn = await page.$(sel);
      if (postulerBtn) { console.log(`Bouton trouvé: ${sel}`); break; }
    }

    if (!postulerBtn) {
      postulerBtn = await page.evaluateHandle(() => {
        const els = [...document.querySelectorAll('a, button')];
        return els.find(el => /postuler|candidater/i.test(el.textContent));
      });
    }

    if (!postulerBtn) throw new Error('Bouton Postuler introuvable');

    await postulerBtn.click();
    await humanDelay();

    // ── Attendre le formulaire de candidature ──────────────────────
    await page.waitForSelector(
      'input[name="firstname"], input[name="prenom"], input[placeholder*="Prénom" i], form input[type="text"]:first-of-type',
      { timeout: 10000 }
    ).catch(() => console.log('Formulaire standard non trouvé, tentative alternative...'));

    // ── Remplir Prénom ─────────────────────────────────────────────
    const prenomSel = 'input[name="firstname"], input[name="prenom"], input[placeholder*="Prénom" i]';
    if (await page.$(prenomSel)) {
      await page.click(prenomSel, { clickCount: 3 });
      await page.type(prenomSel, CANDIDAT.prenom, { delay: 60 });
      await humanDelay();
    }

    // ── Remplir Nom ────────────────────────────────────────────────
    const nomSel = 'input[name="lastname"], input[name="nom"], input[placeholder*="Nom" i]';
    if (await page.$(nomSel)) {
      await page.click(nomSel, { clickCount: 3 });
      await page.type(nomSel, CANDIDAT.nom, { delay: 60 });
      await humanDelay();
    }

    // ── Remplir Email ──────────────────────────────────────────────
    const emailSel = 'input[type="email"], input[name="email"], input[placeholder*="email" i]';
    if (await page.$(emailSel)) {
      await page.click(emailSel, { clickCount: 3 });
      await page.type(emailSel, CANDIDAT.email, { delay: 60 });
      await humanDelay();
    }

    // ── Remplir Téléphone ──────────────────────────────────────────
    const telSel = 'input[type="tel"], input[name="phone"], input[name="telephone"], input[placeholder*="téléphone" i], input[placeholder*="phone" i]';
    if (await page.$(telSel)) {
      await page.click(telSel, { clickCount: 3 });
      await page.type(telSel, CANDIDAT.telephone, { delay: 60 });
      await humanDelay();
    }

    // ── Remplir Lettre de motivation ───────────────────────────────
    const textareaSel = 'textarea[name="message"], textarea[name="coverLetter"], textarea[name="lettre"], textarea[placeholder*="motivation" i], textarea';
    if (await page.$(textareaSel)) {
      await page.click(textareaSel, { clickCount: 3 });
      await page.type(textareaSel, coverLetter, { delay: 15 });
      await humanDelay();
    }

    // ── Upload CV ──────────────────────────────────────────────────
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.uploadFile(CANDIDAT.cvPath);
      await sleep(1500);
      console.log('CV uploadé ✓');
    }

    // ── Soumettre ──────────────────────────────────────────────────
    const submitSel = 'button[type="submit"], input[type="submit"], button[class*="submit"], button[class*="envoyer" i]';
    const submitBtn = await page.$(submitSel);
    if (!submitBtn) throw new Error('Bouton Submit introuvable');

    await submitBtn.click();
    await sleep(3000);

    // ── Vérifier confirmation ──────────────────────────────────────
    const pageContent = await page.content();
    const success =
      /merci|candidature.*envo|confirmation|envoyée/i.test(pageContent) ||
      /thank you|application.*sent/i.test(pageContent);

    console.log(success ? '✅ Candidature envoyée !' : '⚠️ Résultat incertain');
    return {
      success,
      message: success
        ? `Candidature envoyée avec succès pour ${jobUrl}`
        : 'Formulaire soumis mais confirmation incertaine',
      url: page.url(),
    };

  } catch (err) {
    console.error('Erreur:', err.message);
    return { success: false, message: err.message, url: jobUrl };
  } finally {
    await browser.close();
  }
}

// ─── Routes API ────────────────────────────────────────────────────

// Santé
app.get('/health', (req, res) => res.json({ status: 'ok', candidat: CANDIDAT.email }));

// Candidature HelloWork
app.post('/apply', async (req, res) => {
  const { job_url, cover_letter } = req.body;

  if (!job_url || !cover_letter) {
    return res.status(400).json({ error: 'job_url et cover_letter sont requis' });
  }

  // Résoudre les tracking URLs HelloWork
  let actualUrl = job_url;
  if (job_url.includes('emails.hellowork.com/clic')) {
    actualUrl = resolveHelloWorkUrl(job_url);
    console.log(`URL résolue: ${actualUrl}`);
  }

  // Ignorer les URLs non-emploi (logos, navigation, etc.)
  if (!actualUrl.includes('/fr-fr/emplois/')) {
    console.log(`URL ignorée (pas une offre): ${actualUrl}`);
    return res.json({ success: false, message: 'URL non pertinente', url: actualUrl });
  }

  // Dédupliquer : ignorer si déjà candidaté à ce job
  const jobId = extractJobId(actualUrl);
  if (jobId && jobsAlreadyApplied.has(jobId)) {
    console.log(`Job ${jobId} déjà traité, ignoré.`);
    return res.json({ success: false, message: `Déjà candidaté pour le job ${jobId}`, url: actualUrl });
  }
  if (jobId) jobsAlreadyApplied.add(jobId);

  console.log(`\n📨 Nouvelle candidature: ${actualUrl}`);
  const result = await applyHelloWork(actualUrl, cover_letter);
  res.json(result);
});

// ─── Démarrage ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  try {
    await downloadCV();
  } catch (e) {
    console.error('Erreur téléchargement CV:', e.message);
  }
});
