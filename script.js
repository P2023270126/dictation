const STORAGE_KEY = "dictationPracticeArticlesV1";
const SHEET_SOURCES_KEY = "dictationPracticeSheetSourcesV1";

const SAMPLE_ARTICLES = [
  {
    id: "sample-zh",
    title: "示例：中文短文",
    text: "今天陽光很好，爸爸帶我到公園散步。\n我看見一隻小狗，牠正在草地上跑來跑去。\n媽媽說：「我們要準時回家。」",
    lineBreakMode: true
  },
  {
    id: "sample-en",
    title: "Sample: English Passage",
    text: "Today is a sunny day.\nBen goes to the park with his father.\nHe says, \"I like reading books.\"",
    lineBreakMode: true
  }
];

const elements = {
  articleSelect: document.getElementById("articleSelect"),
  deleteArticleSelect: document.getElementById("deleteArticleSelect"),
  articleTitle: document.getElementById("articleTitle"),
  articleText: document.getElementById("articleText"),
  lineBreakMode: document.getElementById("lineBreakMode"),
  sheetName: document.getElementById("sheetName"),
  sheetUrl: document.getElementById("sheetUrl"),
  sheetSourceSelect: document.getElementById("sheetSourceSelect"),
  sheetStatus: document.getElementById("sheetStatus"),
  saveArticleBtn: document.getElementById("saveArticleBtn"),
  deleteArticleBtn: document.getElementById("deleteArticleBtn"),
  saveSheetSourceBtn: document.getElementById("saveSheetSourceBtn"),
  loadSheetBtn: document.getElementById("loadSheetBtn"),
  loadSelectedSheetBtn: document.getElementById("loadSelectedSheetBtn"),
  deleteSheetSourceBtn: document.getElementById("deleteSheetSourceBtn"),
  startBtn: document.getElementById("startBtn"),
  parentSetup: document.getElementById("parentSetup"),
  languageMode: document.getElementById("languageMode"),
  statusText: document.getElementById("statusText"),
  currentSentence: document.getElementById("currentSentence"),
  progressText: document.getElementById("progressText"),
  repeatText: document.getElementById("repeatText"),
  progressBar: document.getElementById("progressBar"),
  prevBtn: document.getElementById("prevBtn"),
  replayBtn: document.getElementById("replayBtn"),
  nextBtn: document.getElementById("nextBtn"),
  readAllBtn: document.getElementById("readAllBtn"),
  stopBtn: document.getElementById("stopBtn"),
  completeMessage: document.getElementById("completeMessage")
};

let articles = [];
let sheetSources = [];
let sheetArticles = [];
let segments = [];
let currentIndex = 0;
let isSpeaking = false;
let activeTimer = null;
let activeDelayResolve = null;
let playbackToken = 0;
let voices = [];

function loadArticles() {
  const savedText = localStorage.getItem(STORAGE_KEY);
  if (savedText === null) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SAMPLE_ARTICLES));
    return [...SAMPLE_ARTICLES];
  }
  return JSON.parse(savedText);
}

function saveArticles() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(articles));
}

function loadSheetSources() {
  return JSON.parse(localStorage.getItem(SHEET_SOURCES_KEY) || "[]");
}

function saveSheetSources() {
  localStorage.setItem(SHEET_SOURCES_KEY, JSON.stringify(sheetSources));
}

function getAllPracticeArticles() {
  return [
    ...articles.map((article) => ({ ...article, sourceType: "local" })),
    ...sheetArticles.map((article) => ({ ...article, sourceType: "sheet" }))
  ];
}

function getSelectedArticle() {
  return getAllPracticeArticles().find((article) => article.id === elements.articleSelect.value);
}

function renderArticleOptions() {
  elements.articleSelect.innerHTML = "";
  elements.deleteArticleSelect.innerHTML = "";

  if (articles.length > 0) {
    const localGroup = document.createElement("optgroup");
    localGroup.label = "本機文章";

    articles.forEach((article) => {
      const option = document.createElement("option");
      option.value = article.id;
      option.textContent = article.title;
      localGroup.appendChild(option);

      const deleteOption = document.createElement("option");
      deleteOption.value = article.id;
      deleteOption.textContent = article.title;
      elements.deleteArticleSelect.appendChild(deleteOption);
    });

    elements.articleSelect.appendChild(localGroup);
  }

  if (sheetArticles.length > 0) {
    const sheetGroup = document.createElement("optgroup");
    sheetGroup.label = "Google Sheet 文章";

    sheetArticles.forEach((article) => {
      const option = document.createElement("option");
      option.value = article.id;
      option.textContent = article.title;
      sheetGroup.appendChild(option);
    });

    elements.articleSelect.appendChild(sheetGroup);
  }

  const firstArticle = getAllPracticeArticles()[0];
  if (firstArticle) {
    elements.articleSelect.value = firstArticle.id;
    if (articles.length > 0) {
      elements.deleteArticleSelect.value = articles[0].id;
    }
    loadSelectedArticle();
  } else {
    elements.articleSelect.innerHTML = '<option value="">未有已儲存文章</option>';
    resetPractice();
    updateStatus("未有已儲存文章。請在家長設定區新增文章，或讀取 Google Sheet。");
  }

  if (articles.length > 0) {
    elements.deleteArticleSelect.value = articles[0].id;
  } else {
    elements.deleteArticleSelect.innerHTML = '<option value="">未有可刪除文章</option>';
  }
}

function loadSelectedArticle() {
  const selected = getSelectedArticle();
  if (!selected) return;

  resetPractice();
  const sourceLabel = selected.sourceType === "sheet" ? "Google Sheet" : "本機";
  updateStatus(`已選擇「${selected.title}」（${sourceLabel}）。文章內容已隱藏，請按「開始默書」。`);
}

function saveCurrentArticle() {
  const title = elements.articleTitle.value.trim();
  const text = elements.articleText.value.trim();
  const lineBreakMode = elements.lineBreakMode.checked;

  if (!title || !text) {
    updateStatus("請先輸入文章名稱和內容。");
    return;
  }

  const titleMatchIndex = articles.findIndex((article) => article.title === title);

  if (titleMatchIndex >= 0) {
    updateStatus("已有同名文章。請先刪除舊文章，或者使用另一個文章名稱。");
    return;
  }

  articles.push({
    id: `article-${Date.now()}`,
    title,
    text,
    lineBreakMode
  });

  saveArticles();
  renderArticleOptions();

  const saved = articles.find((article) => article.title === title);
  if (saved) {
    elements.articleSelect.value = saved.id;
    elements.deleteArticleSelect.value = saved.id;
  }

  elements.articleTitle.value = "";
  elements.articleText.value = "";
  elements.lineBreakMode.checked = true;
  elements.parentSetup.open = false;
  loadSelectedArticle();
  updateStatus("文章已儲存，內容已隱藏。可以按「開始默書」。");
}

function deleteSelectedArticle() {
  const selected = articles.find((article) => article.id === elements.deleteArticleSelect.value);
  if (!selected) {
    updateStatus("未有可刪除的文章。");
    return;
  }

  const ok = window.confirm(`確定刪除「${selected.title}」？刪除後如要修改，需要重新新增文章。`);
  if (!ok) return;

  stopSpeech();
  articles = articles.filter((article) => article.id !== selected.id);
  saveArticles();
  elements.articleTitle.value = "";
  elements.articleText.value = "";
  elements.lineBreakMode.checked = true;
  renderArticleOptions();
  updateStatus(`已刪除「${selected.title}」。`);
}

function renderSheetSourceOptions() {
  elements.sheetSourceSelect.innerHTML = "";

  if (sheetSources.length === 0) {
    elements.sheetSourceSelect.innerHTML = '<option value="">未有已儲存來源</option>';
    return;
  }

  sheetSources.forEach((source) => {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.name;
    elements.sheetSourceSelect.appendChild(option);
  });
}

function saveCurrentSheetSource() {
  const name = elements.sheetName.value.trim();
  const url = elements.sheetUrl.value.trim();

  if (!name || !url) {
    elements.sheetStatus.textContent = "請輸入來源名稱和 Google Sheet CSV 連結。";
    return null;
  }

  const existingIndex = sheetSources.findIndex((source) => source.name === name);
  const source = {
    id: existingIndex >= 0 ? sheetSources[existingIndex].id : `sheet-source-${Date.now()}`,
    name,
    url
  };

  if (existingIndex >= 0) {
    sheetSources[existingIndex] = source;
  } else {
    sheetSources.push(source);
  }

  saveSheetSources();
  renderSheetSourceOptions();
  elements.sheetSourceSelect.value = source.id;
  elements.sheetStatus.textContent = `已儲存來源「${name}」。`;
  return source;
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function normalizeHeader(header) {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function getCsvValue(record, names) {
  for (const name of names) {
    const value = record[normalizeHeader(name)];
    if (value !== undefined) return value.trim();
  }
  return "";
}

function parseBoolean(value, defaultValue = true) {
  if (!value) return defaultValue;
  return /^(true|yes|y|1|是|開|on)$/i.test(value.trim());
}

function articlesFromCsv(csvText, source) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  const result = [];

  rows.slice(1).forEach((cells, index) => {
    const record = {};
    headers.forEach((header, headerIndex) => {
      record[header] = cells[headerIndex] || "";
    });

    const title = getCsvValue(record, ["Title", "文章名稱", "Name"]);
    const text = getCsvValue(record, ["Passage", "Text", "文章", "默書文章", "Content"]);
    const language = getCsvValue(record, ["Language", "Lang", "語言"]);
    const lineBreakMode = parseBoolean(getCsvValue(record, ["LineBreakMode", "LineBreak", "換行", "Enter"]), true);

    if (!title || !text) return;

    result.push({
      id: `sheet:${source.id}:${index}`,
      title: `${source.name}：${title}`,
      text,
      language,
      lineBreakMode,
      sourceName: source.name
    });
  });

  return result;
}

async function loadSheetSource(source) {
  if (!source?.url) {
    elements.sheetStatus.textContent = "請先選擇或儲存一個 Google Sheet 來源。";
    return;
  }

  elements.sheetStatus.textContent = `正在讀取「${source.name}」...`;

  try {
    const response = await fetch(source.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const csvText = await response.text();
    const loadedArticles = articlesFromCsv(csvText, source);

    sheetArticles = [
      ...sheetArticles.filter((article) => article.sourceName !== source.name),
      ...loadedArticles
    ];

    renderArticleOptions();
    if (loadedArticles.length > 0) {
      elements.articleSelect.value = loadedArticles[0].id;
      loadSelectedArticle();
    }
    elements.sheetStatus.textContent = `已讀取「${source.name}」：${loadedArticles.length} 篇文章。`;
    updateStatus(`Google Sheet 已同步：${loadedArticles.length} 篇文章可選。`);
  } catch (error) {
    elements.sheetStatus.textContent = "讀取失敗。請確認 Google Sheet 已 Publish to web，並使用 CSV 連結。";
  }
}

function saveAndLoadCurrentSheetSource() {
  const source = saveCurrentSheetSource();
  if (source) loadSheetSource(source);
}

function loadSelectedSheetSource() {
  const source = sheetSources.find((item) => item.id === elements.sheetSourceSelect.value);
  if (!source) {
    elements.sheetStatus.textContent = "未有選中的 Google Sheet 來源。";
    return;
  }

  elements.sheetName.value = source.name;
  elements.sheetUrl.value = source.url;
  loadSheetSource(source);
}

function deleteSelectedSheetSource() {
  const source = sheetSources.find((item) => item.id === elements.sheetSourceSelect.value);
  if (!source) {
    elements.sheetStatus.textContent = "未有可刪除的 Google Sheet 來源。";
    return;
  }

  const ok = window.confirm(`確定刪除 Google Sheet 來源「${source.name}」？這只會刪除來源設定，不會刪除 Google Sheet 本身。`);
  if (!ok) return;

  sheetSources = sheetSources.filter((item) => item.id !== source.id);
  sheetArticles = sheetArticles.filter((article) => article.sourceName !== source.name);
  saveSheetSources();
  renderSheetSourceOptions();
  renderArticleOptions();
  elements.sheetName.value = "";
  elements.sheetUrl.value = "";
  elements.sheetStatus.textContent = `已刪除來源「${source.name}」。`;
}

function splitLineByPunctuation(line) {
  const matches = line.match(/[^，。！？；：、,.?!;:]+[，。！？；：、,.?!;:]?[」』”"')）]?/g) || [];
  return matches.map((segment) => segment.trim()).filter(Boolean);
}

function splitIntoSegments(text, options = {}) {
  const normalized = text
    .replace(/\r/g, "")
    .replace(/\u3000/g, " ")
    .trim();

  if (options.lineBreakMode !== false) {
    return normalized
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => splitLineByPunctuation(line));
  }

  return splitLineByPunctuation(normalized.replace(/\n+/g, " "));
}

function detectLanguage(text) {
  const chineseChars = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const englishChars = (text.match(/[A-Za-z]/g) || []).length;
  return chineseChars >= englishChars ? "zh" : "en";
}

function getSelectedLanguage(text = "") {
  const mode = elements.languageMode.value;
  return mode === "auto" ? detectLanguage(text) : mode;
}

function getPracticeLanguage(text = "") {
  const mode = elements.languageMode.value;
  if (mode !== "auto") return mode;

  const selected = getSelectedArticle();
  const language = selected?.language?.toLowerCase?.().trim();
  if (language === "zh" || language === "chinese" || language === "cantonese" || language === "yue") return "zh";
  if (language === "en" || language === "english") return "en";

  return detectLanguage(text);
}

function convertPunctuationForSpeech(text, lang) {
  const zhMap = {
    "，": "，逗號，",
    "。": "，句號，",
    "？": "，問號，",
    "?": "，問號，",
    "！": "，感嘆號，",
    "!": "，感嘆號，",
    "：": "，冒號，",
    ":": "，冒號，",
    "；": "，分號，",
    ";": "，分號，",
    "、": "，頓號，",
    "「": "，開引號，",
    "」": "，關引號，",
    "『": "，開雙引號，",
    "』": "，關雙引號，",
    "（": "，開括號，",
    "）": "，關括號，",
    "(": "，開括號，",
    ")": "，關括號，",
    "“": "，開引號，",
    "”": "，關引號，",
    "\"": "，引號，"
  };

  const enMap = {
    ",": ", comma, ",
    ".": ", full stop, ",
    "?": ", question mark, ",
    "!": ", exclamation mark, ",
    ":": ", colon, ",
    ";": ", semicolon, ",
    "\"": ", quotation mark, ",
    "'": ", apostrophe, ",
    "(": ", open bracket, ",
    ")": ", close bracket, "
  };

  const map = lang === "en" ? enMap : zhMap;
  return text
    .split("")
    .map((char) => map[char] || char)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function refreshVoices() {
  voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
}

function chooseVoice(lang) {
  if (!voices.length) refreshVoices();

  const lowerName = (voice) => voice.name.toLowerCase();
  const lowerLang = (voice) => voice.lang.toLowerCase();
  const isFemale = (voice) => /female|woman|samantha|susan|serena|karen|moira|tessa|zira|ava|siri/.test(lowerName(voice));

  if (lang === "en") {
    return (
      voices.find((voice) => lowerLang(voice).startsWith("en-gb") && isFemale(voice)) ||
      voices.find((voice) => lowerLang(voice).startsWith("en-gb")) ||
      voices.find((voice) => lowerLang(voice).startsWith("en-hk") && isFemale(voice)) ||
      voices.find((voice) => lowerLang(voice).startsWith("en-us") && isFemale(voice)) ||
      voices.find((voice) => lowerLang(voice).startsWith("en"))
    ) || null;
  }

  return (
    voices.find((voice) => lowerLang(voice).startsWith("yue")) ||
    voices.find((voice) => lowerLang(voice).startsWith("zh-hk")) ||
    voices.find((voice) => /cantonese|hong kong|yue|粵|粤|廣東|广东/.test(lowerName(voice))) ||
    voices.find((voice) => lowerLang(voice).startsWith("zh-tw")) ||
    voices.find((voice) => lowerLang(voice).startsWith("zh"))
  ) || null;
}

function speakText(text, options = {}) {
  const lang = options.lang || getSelectedLanguage(text);
  const utterance = new SpeechSynthesisUtterance(text);
  const chosenVoice = chooseVoice(lang);

  utterance.lang = lang === "en" ? "en-GB" : "zh-HK";
  utterance.rate = options.rate || 0.62;
  utterance.pitch = 1;

  if (chosenVoice) {
    utterance.voice = chosenVoice;
    utterance.lang = chosenVoice.lang;
  }

  return new Promise((resolve, reject) => {
    utterance.onend = resolve;
    utterance.onerror = (event) => reject(event.error || event);
    window.speechSynthesis.speak(utterance);
  });
}

function clearTimer() {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }

  if (activeDelayResolve) {
    activeDelayResolve(false);
    activeDelayResolve = null;
  }
}

function stopSpeech() {
  playbackToken += 1;
  clearTimer();
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  isSpeaking = false;
  elements.repeatText.textContent = "已停止";
  setButtonStates();
}

function waitWithCancel(ms, token) {
  return new Promise((resolve) => {
    activeDelayResolve = resolve;
    activeTimer = setTimeout(() => {
      activeTimer = null;
      activeDelayResolve = null;
      resolve(token === playbackToken);
    }, ms);
  });
}

function updateStatus(message) {
  elements.statusText.textContent = message;
}

function updatePracticeDisplay() {
  const total = segments.length;
  const current = total ? currentIndex + 1 : 0;
  const percent = total ? (current / total) * 100 : 0;

  elements.currentSentence.textContent = total ? segments[currentIndex] : "尚未開始";
  elements.currentSentence.textContent = total
    ? `第 ${current} 段內容已隱藏，請細心聽。`
    : "內容已隱藏，請用耳仔聽。";
  elements.progressText.textContent = `第 ${current} 段 / 共 ${total} 段`;
  elements.progressBar.style.width = `${percent}%`;
  setButtonStates();
}

function setButtonStates() {
  const hasSegments = segments.length > 0;
  elements.prevBtn.disabled = !hasSegments || currentIndex <= 0 || isSpeaking;
  elements.replayBtn.disabled = !hasSegments || isSpeaking;
  elements.nextBtn.disabled = !hasSegments || isSpeaking;
  elements.readAllBtn.disabled = !hasSegments || isSpeaking;
  elements.startBtn.disabled = isSpeaking;
}

function resetPractice() {
  stopSpeech();
  segments = [];
  currentIndex = 0;
  elements.completeMessage.hidden = true;
  elements.repeatText.textContent = "等待開始";
  updatePracticeDisplay();
}

function preparePractice() {
  const selected = getSelectedArticle();
  const text = selected?.text?.trim() || elements.articleText.value.trim();
  if (!text) {
    updateStatus("請先在家長設定區新增並儲存一篇文章。");
    return false;
  }

  segments = splitIntoSegments(text, {
    lineBreakMode: selected?.lineBreakMode !== false
  });
  currentIndex = 0;
  elements.completeMessage.hidden = true;
  elements.repeatText.textContent = "準備播放";
  updatePracticeDisplay();
  updateStatus(`已準備好：共 ${segments.length} 段。文章內容會保持隱藏。`);
  return true;
}

async function playCurrentSentenceThreeTimes() {
  if (!segments.length) return;

  stopSpeech();
  const token = playbackToken;
  isSpeaking = true;
  setButtonStates();
  elements.completeMessage.hidden = true;

  const sentence = segments[currentIndex];
  const lang = getPracticeLanguage(sentence);
  const speechText = convertPunctuationForSpeech(sentence, lang);

  try {
    for (let repeat = 1; repeat <= 3; repeat += 1) {
      elements.repeatText.textContent = `第 ${repeat} 次朗讀中`;
      await speakText(speechText, { lang });
      if (token !== playbackToken) return;

      if (repeat < 3) {
        elements.repeatText.textContent = "停 3 秒";
        const shouldContinue = await waitWithCancel(3000, token);
        if (!shouldContinue || token !== playbackToken) return;
      }
    }

    elements.repeatText.textContent = "請按「下一句」";
    updateStatus("這一段已讀三次。");
  } catch (error) {
    if (token === playbackToken) {
      updateStatus("朗讀被停止，或瀏覽器暫時未能播放聲音。");
    }
  } finally {
    if (token === playbackToken) {
      isSpeaking = false;
      setButtonStates();
    }
  }
}

async function replayCurrentSentenceOnce() {
  if (!segments.length) return;

  stopSpeech();
  const token = playbackToken;
  isSpeaking = true;
  setButtonStates();

  const sentence = segments[currentIndex];
  const lang = getPracticeLanguage(sentence);
  const speechText = convertPunctuationForSpeech(sentence, lang);

  try {
    elements.repeatText.textContent = "重讀一次中";
    await speakText(speechText, { lang });
    if (token !== playbackToken) return;
    elements.repeatText.textContent = "重讀完成";
  } catch (error) {
    if (token === playbackToken) {
      updateStatus("朗讀被停止，或瀏覽器暫時未能播放聲音。");
    }
  } finally {
    if (token === playbackToken) {
      isSpeaking = false;
      setButtonStates();
    }
  }
}

async function readWholeArticleOnce() {
  if (!segments.length && !preparePractice()) return;

  stopSpeech();
  const token = playbackToken;
  isSpeaking = true;
  setButtonStates();
  elements.completeMessage.hidden = true;
  updateStatus("正在重讀全文。");

  try {
    for (let index = 0; index < segments.length; index += 1) {
      currentIndex = index;
      updatePracticeDisplay();

      const sentence = segments[index];
      const lang = getPracticeLanguage(sentence);
      const speechText = convertPunctuationForSpeech(sentence, lang);
      elements.repeatText.textContent = "全文朗讀中";
      await speakText(speechText, { lang, rate: 0.6 });
      if (token !== playbackToken) return;
    }

    elements.repeatText.textContent = "全文朗讀完成";
    updateStatus("全文已讀完一次。");
  } catch (error) {
    if (token === playbackToken) {
      updateStatus("全文朗讀已停止。");
    }
  } finally {
    if (token === playbackToken) {
      isSpeaking = false;
      setButtonStates();
    }
  }
}

function goToNextSentence() {
  if (!segments.length && !preparePractice()) return;

  if (currentIndex >= segments.length - 1) {
    elements.completeMessage.hidden = false;
    elements.repeatText.textContent = "已完成";
    updateStatus("太好了！整篇默書已完成。");
    updatePracticeDisplay();
    return;
  }

  currentIndex += 1;
  updatePracticeDisplay();
  playCurrentSentenceThreeTimes();
}

function goToPreviousSentence() {
  if (!segments.length || currentIndex <= 0) return;
  currentIndex -= 1;
  updatePracticeDisplay();
  playCurrentSentenceThreeTimes();
}

function startPractice() {
  if (!preparePractice()) return;
  playCurrentSentenceThreeTimes();
}

function init() {
  if (!("speechSynthesis" in window)) {
    updateStatus("你的瀏覽器暫時不支援朗讀功能。請試 Chrome、Edge 或 Safari。");
  }

  refreshVoices();
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }

  articles = loadArticles();
  sheetSources = loadSheetSources();
  renderArticleOptions();
  renderSheetSourceOptions();

  elements.articleSelect.addEventListener("change", loadSelectedArticle);
  elements.saveArticleBtn.addEventListener("click", saveCurrentArticle);
  elements.deleteArticleBtn.addEventListener("click", deleteSelectedArticle);
  elements.saveSheetSourceBtn.addEventListener("click", saveCurrentSheetSource);
  elements.loadSheetBtn.addEventListener("click", saveAndLoadCurrentSheetSource);
  elements.loadSelectedSheetBtn.addEventListener("click", loadSelectedSheetSource);
  elements.deleteSheetSourceBtn.addEventListener("click", deleteSelectedSheetSource);
  elements.sheetSourceSelect.addEventListener("change", () => {
    const source = sheetSources.find((item) => item.id === elements.sheetSourceSelect.value);
    if (!source) return;
    elements.sheetName.value = source.name;
    elements.sheetUrl.value = source.url;
  });
  elements.startBtn.addEventListener("click", startPractice);
  elements.prevBtn.addEventListener("click", goToPreviousSentence);
  elements.replayBtn.addEventListener("click", replayCurrentSentenceOnce);
  elements.nextBtn.addEventListener("click", goToNextSentence);
  elements.readAllBtn.addEventListener("click", readWholeArticleOnce);
  elements.stopBtn.addEventListener("click", stopSpeech);
  elements.languageMode.addEventListener("change", () => {
    updateStatus("朗讀語言設定已更新。");
  });

  resetPractice();
  updateStatus("你可以先用示例文章測試，或貼上自己的默書文章。");
}

init();
