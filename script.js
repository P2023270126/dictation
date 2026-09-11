const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRfmlTFpkVroBCn-XVabMyXFPb-TDwvpqmHGH6hJc1NmN7t8CwtXpVeGnm2DfF36hzzYGDC0Wja0iAC/pub?output=csv";
const SENTENCE_REPEAT_COUNT = 3;
const REPEAT_PAUSE_MS = 6000;
const SENTENCE_PAUSE_MS = 6000;
const CHINESE_SPEECH_RATE = 0.82;
const ENGLISH_SPEECH_RATE = 0.5;

const STORAGE_KEYS = {
  zhVoice: "dictationCoach.zhVoiceURI",
  enVoice: "dictationCoach.enVoiceURI"
};

const elements = {};
const state = {
  articles: [],
  currentArticle: null,
  sentences: [],
  currentIndex: 0,
  voices: [],
  isSpeaking: false,
  isCompleted: false,
  isRepeatingAll: false,
  speechToken: 0
};

document.addEventListener("DOMContentLoaded", () => {
  collectElements();
  bindEvents();
  loadVoices();
  loadArticlesFromSheet();

  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
});

function collectElements() {
  elements.articleSelect = document.querySelector("#articleSelect");
  elements.startBtn = document.querySelector("#startBtn");
  elements.prevBtn = document.querySelector("#prevBtn");
  elements.nextBtn = document.querySelector("#nextBtn");
  elements.repeatBtn = document.querySelector("#repeatBtn");
  elements.repeatAllBtn = document.querySelector("#repeatAllBtn");
  elements.stopBtn = document.querySelector("#stopBtn");
  elements.progressText = document.querySelector("#progressText");
  elements.statusText = document.querySelector("#statusText");
  elements.settingsToggle = document.querySelector("#settingsToggle");
  elements.settingsBody = document.querySelector("#settingsBody");
  elements.zhVoiceSelect = document.querySelector("#zhVoiceSelect");
  elements.enVoiceSelect = document.querySelector("#enVoiceSelect");
  elements.refreshVoicesBtn = document.querySelector("#refreshVoicesBtn");
  elements.voiceStatus = document.querySelector("#voiceStatus");
}

function bindEvents() {
  elements.articleSelect.addEventListener("change", selectArticle);
  elements.startBtn.addEventListener("click", startPractice);
  elements.prevBtn.addEventListener("click", previousSentence);
  elements.nextBtn.addEventListener("click", nextSentence);
  elements.repeatBtn.addEventListener("click", repeatCurrentSentence);
  elements.repeatAllBtn.addEventListener("click", repeatWholeArticle);
  elements.stopBtn.addEventListener("click", stopSpeech);
  elements.refreshVoicesBtn.addEventListener("click", loadVoices);

  elements.settingsToggle.addEventListener("click", () => {
    const isOpen = !elements.settingsBody.hidden;
    elements.settingsBody.hidden = isOpen;
    elements.settingsToggle.setAttribute("aria-expanded", String(!isOpen));
  });

  elements.zhVoiceSelect.addEventListener("change", () => {
    localStorage.setItem(STORAGE_KEYS.zhVoice, elements.zhVoiceSelect.value);
    updateVoiceStatus();
  });

  elements.enVoiceSelect.addEventListener("change", () => {
    localStorage.setItem(STORAGE_KEYS.enVoice, elements.enVoiceSelect.value);
    updateVoiceStatus();
  });
}

async function loadArticlesFromSheet() {
  setStatus("正在讀取 Google Sheet...");
  elements.articleSelect.innerHTML = '<option value="">正在讀取文章...</option>';
  elements.articleSelect.disabled = true;
  elements.startBtn.disabled = true;

  try {
    const url = `${GOOGLE_SHEET_CSV_URL}&cacheBust=${Date.now()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const csv = await response.text();
    const articles = parseArticlesFromCsv(csv);

    if (!articles.length) {
      throw new Error("No articles found");
    }

    state.articles = articles;
    renderArticleOptions();
    setStatus(`已讀取 ${articles.length} 篇文章`);
  } catch (error) {
    console.error(error);
    state.articles = [];
    elements.articleSelect.innerHTML = '<option value="">未能讀取文章</option>';
    setStatus("讀取失敗，請檢查 Google Sheet 是否已 publish as CSV");
  }
}

function parseArticlesFromCsv(csvText) {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim() !== ""));

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(normalizeHeader);
  const titleIndex = findHeaderIndex(headers, ["title", "name", "文章", "標題"]);
  const languageIndex = findHeaderIndex(headers, ["language", "lang", "語言"]);
  const lineBreakIndex = findHeaderIndex(headers, ["linebreakmode", "linebreak", "manualbreak", "分行", "換行"]);
  const passageIndex = findHeaderIndex(headers, ["passage", "text", "content", "article", "文章內容", "內容"]);

  if (titleIndex === -1 || passageIndex === -1) {
    return [];
  }

  return rows.slice(1).map((row, index) => {
    const title = (row[titleIndex] || "").trim();
    const passage = (row[passageIndex] || "").trim();

    if (!title || !passage) {
      return null;
    }

    return {
      id: `sheet-${index}`,
      title,
      language: normalizeLanguage(row[languageIndex] || passage),
      lineBreakMode: isTruthy(row[lineBreakIndex]),
      passage
    };
  }).filter(Boolean);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function findHeaderIndex(headers, names) {
  return headers.findIndex((header) => names.includes(header));
}

function normalizeLanguage(value) {
  const input = String(value || "").trim().toLowerCase();

  if (input.includes("zh") || input.includes("chinese") || input.includes("中文") || input.includes("cantonese") || input.includes("粵")) {
    return "zh";
  }

  if (input.includes("en") || input.includes("english")) {
    return "en";
  }

  return /[\u4e00-\u9fff]/.test(input) ? "zh" : "en";
}

function isTruthy(value) {
  return ["true", "yes", "y", "1", "manual"].includes(String(value || "").trim().toLowerCase());
}

function renderArticleOptions() {
  elements.articleSelect.innerHTML = '<option value="">請選擇文章</option>';

  state.articles.forEach((article) => {
    const option = document.createElement("option");
    option.value = article.id;
    option.textContent = article.title;
    elements.articleSelect.appendChild(option);
  });

  elements.articleSelect.disabled = false;
  updateControls();
}

function selectArticle() {
  const articleId = elements.articleSelect.value;
  const article = state.articles.find((item) => item.id === articleId);

  stopSpeech();
  state.currentArticle = article || null;
  state.sentences = article ? splitPassage(article.passage, article.lineBreakMode) : [];
  state.currentIndex = 0;
  state.isCompleted = false;

  if (article && state.sentences.length) {
    setStatus("已選擇文章，可以開始");
  } else {
    setStatus("請先選擇文章");
  }

  updateControls();
}

function splitPassage(passage, lineBreakMode) {
  if (lineBreakMode && passage.includes("\n")) {
    return passage.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  const matches = passage.match(/[^。！？!?；;，,\.]+[。！？!?；;，,\.]?/g) || [];
  return matches.map((sentence) => sentence.trim()).filter(Boolean);
}

function startPractice() {
  if (!state.currentArticle || !state.sentences.length) {
    return;
  }

  stopSpeech(false);
  state.currentIndex = 0;
  state.isCompleted = false;
  speakCurrentSentence();
}

function previousSentence() {
  if (state.currentIndex <= 0) {
    return;
  }

  stopSpeech(false);
  state.currentIndex -= 1;
  state.isCompleted = false;
  speakCurrentSentence();
}

function nextSentence() {
  if (!state.sentences.length) {
    return;
  }

  if (state.currentIndex >= state.sentences.length - 1) {
    markCompleted();
    return;
  }

  stopSpeech(false);
  state.currentIndex += 1;
  speakCurrentSentence();
}

function repeatCurrentSentence() {
  if (!state.currentArticle || !state.sentences.length) {
    return;
  }

  stopSpeech(false);
  speakCurrentSentence();
}

async function repeatWholeArticle() {
  if (!state.isCompleted || !state.sentences.length) {
    return;
  }

  stopSpeech(false);
  state.isRepeatingAll = true;
  setStatus("正在重讀全文...");
  updateControls();

  for (let i = 0; i < state.sentences.length; i += 1) {
    if (!state.isRepeatingAll) {
      break;
    }
    state.currentIndex = i;
    updateProgress();
    await speakSentenceRepeated(state.sentences[i], state.currentArticle.language, false);
    if (i < state.sentences.length - 1) {
      await wait(SENTENCE_PAUSE_MS);
    }
  }

  state.isRepeatingAll = false;
  state.isSpeaking = false;
  setStatus("全文重讀完成");
  updateControls();
}

function speakCurrentSentence() {
  const sentence = state.sentences[state.currentIndex];

  if (!sentence) {
    return;
  }

  state.isSpeaking = true;
  setStatus(`朗讀中...（第 1 / ${SENTENCE_REPEAT_COUNT} 次）`);
  updateControls();
  updateProgress();

  speakSentenceRepeated(sentence, state.currentArticle.language, true);
}

async function speakSentenceRepeated(sentence, language, shouldMarkComplete) {
  if (!("speechSynthesis" in window)) {
    setStatus("此瀏覽器不支援朗讀功能");
    return;
  }

  const token = state.speechToken + 1;
  state.speechToken = token;
  state.isSpeaking = true;
  updateControls();

  for (let repeatIndex = 1; repeatIndex <= SENTENCE_REPEAT_COUNT; repeatIndex += 1) {
    if (token !== state.speechToken) {
      return;
    }

    setStatus(`朗讀中...（第 ${repeatIndex} / ${SENTENCE_REPEAT_COUNT} 次）`);
    const success = await speakSentenceOnce(sentence, language, token);

    if (!success || token !== state.speechToken) {
      return;
    }

    if (repeatIndex < SENTENCE_REPEAT_COUNT) {
      setStatus(`暫停 ${REPEAT_PAUSE_MS / 1000} 秒後重讀...`);
      await wait(REPEAT_PAUSE_MS);
    }
  }

  if (token !== state.speechToken) {
    return;
  }

  state.isSpeaking = false;

  if (shouldMarkComplete && state.currentIndex === state.sentences.length - 1) {
    markCompleted();
  } else if (!state.isRepeatingAll) {
    setStatus(`已讀完本句（共 ${SENTENCE_REPEAT_COUNT} 次）`);
    updateControls();
  }

  updateVoiceStatus();
}

function speakSentenceOnce(sentence, language, token) {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(formatTextForSpeech(sentence, language));
    utterance.lang = language === "zh" ? "zh-HK" : "en-GB";
    utterance.rate = language === "zh" ? CHINESE_SPEECH_RATE : ENGLISH_SPEECH_RATE;
    utterance.pitch = 1;

    const voice = chooseVoice(language);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || utterance.lang;
    }

    utterance.onend = () => {
      if (token !== state.speechToken) {
        resolve(false);
        return;
      }
      resolve(true);
    };

    utterance.onerror = () => {
      if (token === state.speechToken) {
        state.isSpeaking = false;
        setStatus("朗讀失敗，請再試一次");
        updateControls();
      }
      resolve(false);
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

function formatTextForSpeech(sentence, language) {
  if (language === "zh") {
    return sentence
      .replace(/，/g, "，逗號")
      .replace(/。/g, "。句號")
      .replace(/！/g, "。感嘆號")
      .replace(/？/g, "。問號")
      .replace(/；/g, "。分號");
  }

  return sentence
    .replace(/,/g, ", comma")
    .replace(/\./g, ". full stop")
    .replace(/!/g, "! exclamation mark")
    .replace(/\?/g, "? question mark")
    .replace(/;/g, "; semicolon");
}

function stopSpeech(showStoppedStatus = true) {
  state.speechToken += 1;
  state.isSpeaking = false;
  state.isRepeatingAll = false;

  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  if (showStoppedStatus) {
    setStatus("已停止朗讀");
  }

  updateControls();
}

function markCompleted() {
  state.isSpeaking = false;
  state.isCompleted = true;
  state.isRepeatingAll = false;
  setStatus("完成整篇文章，可以重讀全文");
  updateControls();
  updateProgress();
}

function updateControls() {
  const hasArticle = Boolean(state.currentArticle && state.sentences.length);

  elements.startBtn.disabled = !hasArticle;
  elements.startBtn.textContent = state.isSpeaking ? "朗讀中" : (state.isCompleted ? "重新開始默書" : "開始默書");
  elements.prevBtn.disabled = !hasArticle || state.currentIndex <= 0 || state.isRepeatingAll;
  elements.nextBtn.disabled = !hasArticle || state.isRepeatingAll || state.currentIndex >= state.sentences.length - 1;
  elements.repeatBtn.disabled = !hasArticle || state.isRepeatingAll;
  elements.repeatAllBtn.disabled = !hasArticle || !state.isCompleted || state.isRepeatingAll;
  elements.stopBtn.disabled = !state.isSpeaking && !state.isRepeatingAll;

  updateProgress();
}

function updateProgress() {
  if (!state.currentArticle || !state.sentences.length) {
    elements.progressText.textContent = "尚未開始";
    return;
  }

  elements.progressText.textContent = `第 ${state.currentIndex + 1} / ${state.sentences.length} 句`;
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function loadVoices() {
  if (!("speechSynthesis" in window)) {
    elements.voiceStatus.textContent = "此瀏覽器不支援朗讀功能";
    return;
  }

  state.voices = window.speechSynthesis.getVoices() || [];
  populateVoiceSelect(elements.zhVoiceSelect, STORAGE_KEYS.zhVoice);
  populateVoiceSelect(elements.enVoiceSelect, STORAGE_KEYS.enVoice);
  updateVoiceStatus();
}

function populateVoiceSelect(select, storageKey) {
  const savedValue = localStorage.getItem(storageKey) || "auto";
  select.innerHTML = '<option value="auto">自動選擇（女聲優先）</option>';

  state.voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})`;
    select.appendChild(option);
  });

  select.value = state.voices.some((voice) => voice.voiceURI === savedValue) ? savedValue : "auto";
}

function chooseVoice(language) {
  const select = language === "zh" ? elements.zhVoiceSelect : elements.enVoiceSelect;
  const selectedUri = select.value;

  if (selectedUri && selectedUri !== "auto") {
    return state.voices.find((voice) => voice.voiceURI === selectedUri) || null;
  }

  return getBestVoice(language);
}

function getBestVoice(language) {
  if (!state.voices.length) {
    return null;
  }

  const ranked = state.voices.map((voice) => ({
    voice,
    score: scoreVoice(voice, language)
  })).sort((a, b) => b.score - a.score);

  return ranked[0]?.score > -100 ? ranked[0].voice : null;
}

function scoreVoice(voice, language) {
  const name = `${voice.name} ${voice.voiceURI}`.toLowerCase();
  const lang = String(voice.lang || "").toLowerCase();
  let score = 0;

  const femaleNames = ["female", "samantha", "victoria", "serena", "karen", "moira", "fiona", "tessa", "susan", "zira", "aria", "jenny", "sonia", "libby", "maisie", "ava", "allison", "nicky", "siri"];
  const maleNames = ["male", "daniel", "alex", "tom", "fred", "aaron", "oliver", "gordon", "arthur", "ralph"];

  if (language === "en") {
    if (lang === "en-gb") score += 80;
    if (lang.startsWith("en")) score += 35;
    if (!lang.startsWith("en")) score -= 80;
  } else {
    if (lang === "zh-hk" || lang.startsWith("yue")) score += 90;
    if (lang.startsWith("zh")) score += 40;
    if (!lang.startsWith("zh") && !lang.startsWith("yue")) score -= 80;
  }

  if (femaleNames.some((item) => name.includes(item))) score += 35;
  if (maleNames.some((item) => name.includes(item))) score -= 45;
  if (voice.localService) score += 5;

  return score;
}

function updateVoiceStatus() {
  const zhVoice = chooseVoice("zh");
  const enVoice = chooseVoice("en");
  const zhName = zhVoice ? `${zhVoice.name} (${zhVoice.lang})` : "未偵測到";
  const enName = enVoice ? `${enVoice.name} (${enVoice.lang})` : "未偵測到";

  elements.voiceStatus.textContent = `目前預設：中文 ${zhName}；英文 ${enName}`;
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
