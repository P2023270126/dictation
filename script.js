const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRfmlTFpkVroBCn-XVabMyXFPb-TDwvpqmHGH6hJc1NmN7t8CwtXpVeGnm2DfF36hzzYGDC0Wja0iAC/pub?output=csv";

const elements = {
  articleSelect: document.getElementById("articleSelect"),
  libraryStatus: document.getElementById("libraryStatus"),
  startBtn: document.getElementById("startBtn"),
  languageMode: document.getElementById("languageMode"),
  statusText: document.getElementById("statusText"),
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
let segments = [];
let currentIndex = 0;
let isSpeaking = false;
let activeTimer = null;
let activeDelayResolve = null;
let playbackToken = 0;
let voices = [];
let practiceCompleted = false;

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

function articlesFromCsv(csvText) {
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
      id: `sheet-article-${index}`,
      title,
      text,
      language,
      lineBreakMode
    });
  });

  return result;
}

async function loadArticleLibrary() {
  elements.articleSelect.innerHTML = '<option value="">正在讀取文章庫...</option>';
  elements.libraryStatus.textContent = "正在同步 Google Sheet 最新文章庫...";
  elements.statusText.textContent = "正在讀取 Google Sheet 文章庫...";
  setButtonStates();

  try {
    const response = await fetch(GOOGLE_SHEET_CSV_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const csvText = await response.text();
    articles = articlesFromCsv(csvText);
    renderArticleOptions();

    if (articles.length > 0) {
      elements.libraryStatus.textContent = `已同步 Google Sheet：${articles.length} 篇文章。`;
      elements.statusText.textContent = "請選擇文章，然後按「開始默書」。";
    } else {
      elements.libraryStatus.textContent = "Google Sheet 暫時未有可用文章。請確認欄位為 Title、Language、LineBreakMode、Passage。";
      elements.statusText.textContent = "未有可用文章。";
    }
  } catch (error) {
    articles = [];
    renderArticleOptions();
    elements.libraryStatus.textContent = "讀取 Google Sheet 失敗。請確認 Published CSV link 仍然有效。";
    elements.statusText.textContent = "文章庫讀取失敗。";
  }
}

function renderArticleOptions() {
  elements.articleSelect.innerHTML = "";

  if (articles.length === 0) {
    elements.articleSelect.innerHTML = '<option value="">未有可用文章</option>';
    resetPractice();
    return;
  }

  articles.forEach((article) => {
    const option = document.createElement("option");
    option.value = article.id;
    option.textContent = article.title;
    elements.articleSelect.appendChild(option);
  });

  elements.articleSelect.value = articles[0].id;
  loadSelectedArticle();
}

function getSelectedArticle() {
  return articles.find((article) => article.id === elements.articleSelect.value);
}

function loadSelectedArticle() {
  const selected = getSelectedArticle();
  if (!selected) return;

  resetPractice();
  elements.statusText.textContent = `已選擇「${selected.title}」。文章內容已隱藏，請按「開始默書」。`;
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

function getPracticeLanguage(text = "") {
  const mode = elements.languageMode.value;
  if (mode !== "auto") return mode;

  const selected = getSelectedArticle();
  const language = selected?.language?.toLowerCase?.().trim();
  if (["zh", "chinese", "cantonese", "yue"].includes(language)) return "zh";
  if (["en", "english"].includes(language)) return "en";

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
  const lang = options.lang || getPracticeLanguage(text);
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

function updatePracticeDisplay() {
  const total = segments.length;
  const current = total ? currentIndex + 1 : 0;
  const percent = total ? (current / total) * 100 : 0;

  elements.progressText.textContent = `第 ${current} 段 / 共 ${total} 段`;
  elements.progressBar.style.width = `${percent}%`;
  setButtonStates();
}

function setButtonStates() {
  const hasArticles = articles.length > 0;
  const hasSegments = segments.length > 0;
  const startText = !hasArticles
    ? "正在讀取文章..."
    : isSpeaking
      ? "朗讀中..."
      : practiceCompleted
        ? "重新開始默書"
        : "開始默書";

  elements.startBtn.textContent = startText;
  elements.prevBtn.disabled = !hasSegments || currentIndex <= 0 || isSpeaking;
  elements.replayBtn.disabled = !hasSegments || isSpeaking;
  elements.nextBtn.disabled = !hasSegments || isSpeaking;
  elements.readAllBtn.disabled = !hasSegments || !practiceCompleted || isSpeaking;
  elements.startBtn.disabled = !hasArticles || isSpeaking;
}

function resetPractice() {
  stopSpeech();
  segments = [];
  currentIndex = 0;
  practiceCompleted = false;
  elements.completeMessage.hidden = true;
  elements.repeatText.textContent = "等待開始";
  updatePracticeDisplay();
}

function preparePractice() {
  const selected = getSelectedArticle();
  const text = selected?.text?.trim();
  if (!text) {
    elements.statusText.textContent = "未有可用文章。請檢查 Google Sheet。";
    return false;
  }

  segments = splitIntoSegments(text, {
    lineBreakMode: selected?.lineBreakMode !== false
  });
  currentIndex = 0;
  practiceCompleted = false;
  elements.completeMessage.hidden = true;
  elements.repeatText.textContent = "準備播放";
  updatePracticeDisplay();
  elements.statusText.textContent = `已準備好：共 ${segments.length} 段。文章內容會保持隱藏。`;
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
    elements.statusText.textContent = "這一段已讀三次。";
  } catch (error) {
    if (token === playbackToken) {
      elements.statusText.textContent = "朗讀被停止，或瀏覽器暫時未能播放聲音。";
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
      elements.statusText.textContent = "朗讀被停止，或瀏覽器暫時未能播放聲音。";
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
  elements.statusText.textContent = "正在重讀全文。";

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
    elements.statusText.textContent = "全文已讀完一次。";
  } catch (error) {
    if (token === playbackToken) {
      elements.statusText.textContent = "全文朗讀已停止。";
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
    practiceCompleted = true;
    elements.completeMessage.hidden = false;
    elements.repeatText.textContent = "已完成";
    elements.statusText.textContent = "太好了！整篇默書已完成。";
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
    elements.statusText.textContent = "你的瀏覽器暫時不支援朗讀功能。請試 Chrome、Edge 或 Safari。";
  }

  refreshVoices();
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }

  elements.articleSelect.addEventListener("change", loadSelectedArticle);
  elements.startBtn.addEventListener("click", startPractice);
  elements.prevBtn.addEventListener("click", goToPreviousSentence);
  elements.replayBtn.addEventListener("click", replayCurrentSentenceOnce);
  elements.nextBtn.addEventListener("click", goToNextSentence);
  elements.readAllBtn.addEventListener("click", readWholeArticleOnce);
  elements.stopBtn.addEventListener("click", stopSpeech);
  elements.languageMode.addEventListener("change", () => {
    elements.statusText.textContent = "朗讀語言設定已更新。";
  });

  resetPractice();
  loadArticleLibrary();
}

init();
