import { QuestionBank } from './types';

export const USERSCRIPT_CONTENT = `// ==UserScript==
// @name         Chaoxing Work Scraper
// @namespace    cx-work-scraper
// @version      1.3.0
// @description  提取超星作业页题目与选项，导出JSON/CSV
// @match        *://*.chaoxing.com/*work/dowork*
// @match        *://*.chaoxing.com/*exam*
// @all-frames   true
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
  /* ... Please use the full script from the copy button ... */
})();`;

export const FULL_USERSCRIPT = `// ==UserScript==
// @name         Chaoxing Work Scraper
// @namespace    cx-work-scraper
// @version      1.3.0
// @description  提取超星作业页题目与选项，导出JSON/CSV
// @match        *://*.chaoxing.com/*work/dowork*
// @match        *://*.chaoxing.com/*exam*
// @match        *://*.chaoxing.com/*work/dowork*
// @match        *://*.chaoxing.com/*exam*
// @match        *://*.chaoxing.com/exam-ans*
// @match        *://*.chaoxing.com/*/test/*
// @match        *://*.chaoxing.com/*paper*
// @all-frames   true
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
  const normalizeText = s => (s || "").replace(/\\s+/g, " ").trim();
  const getQuestionTitle = box => {
    const sel = [".subject",".stem",".title",".qTitle",".des",".topic",".problem",".quest-title",".quesTitle",".queTitle"];
    for (const q of sel) { const el = box.querySelector(q); if (el) return normalizeText(el.textContent); }
    const h = box.querySelector("h1,h2,h3,.hd,.head,.tt"); if (h) return normalizeText(h.textContent);
    const c = box.cloneNode(true); c.querySelectorAll("input,textarea,select,script,style").forEach(e=>e.remove()); return normalizeText(c.textContent);
  };
  const detectType = box => {
    if (box.querySelector('input[type="radio"]')) return "单选";
    if (box.querySelector('input[type="checkbox"]')) return "多选";
    if (box.querySelector('div[role="checkbox"]')) return "多选";
    if (box.querySelector('div[role="radio"], [onclick*="addChoice"]')) return "单选";
    if (box.querySelector('input[type="text"], textarea')) return "填空";
    const t = normalizeText(box.textContent); if (/判断|对错/.test(t)) return "判断"; return "未知";
  };
  const extractImages = box => Array.from(new Set(Array.from(box.querySelectorAll("img")).map(img => img.src).filter(Boolean)));
  const optionNodesFromInputs = box => {
    const inputs = Array.from(box.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
    const nodes = inputs.map(input => input.closest('li, dd, .option, .opt, .answer, .ui-radio, .ui-checkbox, label, div') || input.parentElement || input);
    const uniq = []; const seen = new Set();
    for (const n of nodes) { if (!seen.has(n)) { uniq.push(n); seen.add(n); } }
    return uniq;
  };
  const choiceNodesViaRole = box => {
    const n1 = Array.from(box.querySelectorAll('div[role="radio"], div[role="checkbox"]'));
    const n2 = Array.from(box.querySelectorAll('.workTextWrap.answerBg'));
    const n3 = Array.from(box.querySelectorAll('[onclick*="addChoice"]'));
    const nodes = [...n1, ...n2, ...n3].filter(n => n.querySelector('.answer_p, span.num_option') || n.getAttribute('aria-label'));
    const uniq = []; const seen = new Set();
    for (const n of nodes) { if (!seen.has(n)) { uniq.push(n); seen.add(n); } }
    return uniq;
  };
  const readOptionLabel = node => {
    const s = node.querySelector('span.num_option');
    if (s) return s.getAttribute('data') || (normalizeText(s.textContent).replace(/[^A-Z]/g,'').charAt(0) || "");
    const aria = node.getAttribute('aria-label') || "";
    const m = aria.match(/^[A-Z]/);
    return m ? m[0] : "";
  };
  const readOptionText = node => {
    const direct = node.querySelector('.answer_p p, .answer_p');
    if (direct) return normalizeText(direct.textContent);
    const aria = node.getAttribute('aria-label');
    if (aria) return normalizeText(aria.replace(/^([A-Z])\\s*/, '').replace(/选择$/, ''));
    const target = node.querySelector('label, .label, .optText, .optionTxt, .txt, .content, p, span, i') || node;
    const clone = target.cloneNode(true);
    clone.querySelectorAll('input, script, style, span.num_option').forEach(e => e.remove());
    return normalizeText(clone.textContent);
  };
  const extractOptions = box => {
    const nodes = [...optionNodesFromInputs(box), ...choiceNodesViaRole(box)];
    const uniq = []; const seen = new Set();
    for (const n of nodes) { if (!seen.has(n)) { uniq.push(n); seen.add(n); } }
    if (!uniq.length) {
      const oc = box.querySelector('.answers,.opts,.optionUl,.optionList,.options,.xuanxiang,.answerArea,.optList,.selectOptions, ul');
      if (!oc) return [];
      const fallbackItems = oc.querySelectorAll('li, .opt, .option, .answer');
      return Array.from(fallbackItems).map((li, idx) => {
        const text = readOptionText(li);
        const label = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt(idx) || "";
        return text ? { label, text } : null;
      }).filter(Boolean);
    }
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const opts = uniq.map((n, idx) => {
      const text = readOptionText(n);
      if (!text) return null;
      const label = readOptionLabel(n) || (letters[idx] || "");
      return { label, text };
    }).filter(Boolean);

    // 去重：同一题中按 label+text 唯一
    const map = new Map();
    opts.forEach(o => {
      const key = \`\${o.label}|\${o.text}\`;
      if (!map.has(key)) map.set(key, o);
    });
    return Array.from(map.values());
  };
  const extractSelected = box => {
    const roleNodes = choiceNodesViaRole(box);
    if (roleNodes.length) {
      const sel = roleNodes.filter(n => (n.getAttribute('aria-checked') === 'true') || /\\b(on|selected|active|checked)\\b/.test(n.className));
      const texts = sel.map(readOptionText).filter(Boolean);
      if (texts.length) return texts;
    }
    const radios = Array.from(box.querySelectorAll('input[type="radio"]:checked'));
    const checks = Array.from(box.querySelectorAll('input[type="checkbox"]:checked'));
    const textOf = input => {
      const node = input.closest('li, dd, .option, .opt, .answer, .ui-radio, .ui-checkbox, label, div') || input.parentElement || input;
      return readOptionText(node);
    };
    if (radios.length) return radios.map(textOf).filter(Boolean);
    if (checks.length) return checks.map(textOf).filter(Boolean);
    const inputs = Array.from(box.querySelectorAll('input[type="text"], textarea')).map(i => normalizeText(i.value));
    const editables = Array.from(box.querySelectorAll('[contenteditable="true"], .contenteditable, .richTextEditor, .ueditor, .editor'))
      .map(el => normalizeText(el.textContent))
      .filter(Boolean);
    return [...inputs.filter(Boolean), ...editables];
  };
  const extractStdAnswerByText = box => {
    const text = normalizeText(box.textContent);
    const m = text.match(/(正确答案|标准答案|参考答案)\\s*[:：]\\s*([A-Z]+|[^。；\\n]+)/); if (m && m[2]) return [normalizeText(m[2])];
    const cand = box.querySelector(".rightAnswer,.standardAnswer,.answerRight,.correctAnswer"); if (cand) { const t = normalizeText(cand.textContent); if (t) return [t]; }
    return [];
  };
  const isQuestionBox = el => {
    const hasInputs = el.querySelector('input[type="radio"], input[type="checkbox"], input[type="text"], textarea');
    const hasRoleChoice = el.querySelector('div[role="radio"], div[role="checkbox"], .workTextWrap.answerBg, [onclick*="addChoice"]');
    const hasAnswer = el.querySelector('.rightAnswer,.standardAnswer,.answerRight,.correctAnswer');
    const hasQid = el.querySelector('[qid]');
    // 仅当存在交互或答案或 qid 时才认为是题块，避免把试卷标题等误识别为题目
    return !!(hasInputs || hasRoleChoice || hasAnswer || hasQid);
  };
  const collectBoxes = () => {
    const sels = [".questionLi",".TiMu",".queBox",".examItem",".workQuestion",".quesItem",".problemItem",".questItem"];
    let boxes = [];
    for (const s of sels) boxes = boxes.concat(Array.from(document.querySelectorAll(s)));

    // 优先按 qid 分组（每题唯一），防止整页容器被误识别
    const qidMap = new Map();
    const qidNodes = Array.from(document.querySelectorAll('[qid]'));
    qidNodes.forEach(el => {
      const qid = el.getAttribute('qid');
      if (!qid) return;
      let box = el.closest('.TiMu,.questionLi,.examItem,.workQuestion,.quesItem,.problemItem,.questItem');
      if (!box) box = el;
      if (!qidMap.has(qid)) qidMap.set(qid, box);
    });

    // 对选择题 DOM（role=radio/checkbox 和 .workTextWrap.answerBg）做兜底分组
    const choiceDom = Array.from(document.querySelectorAll('div[role="radio"], div[role="checkbox"], .workTextWrap.answerBg'));
    choiceDom.forEach(el => {
      let box = el.closest('.TiMu,.questionLi,.examItem,.workQuestion,.quesItem,.problemItem,.questItem');
      if (!box) box = el.parentElement || el;
      boxes.push(box);
    });

    // 文本输入题兜底分组
    const textInputs = Array.from(document.querySelectorAll('input[type="text"], textarea, [contenteditable="true"]'));
    textInputs.forEach(el => {
      let box = el.closest('.TiMu,.questionLi,.examItem,.workQuestion,.quesItem,.problemItem,.questItem');
      if (!box) box = el.parentElement || el;
      boxes.push(box);
    });

    // 合并：qid 分组优先，其次按容器唯一去重
    const fromQid = Array.from(qidMap.values());
    const raw = fromQid.concat(boxes);
    const uniq = []; const seen = new Set();
    for (const b of raw) { if (b && !seen.has(b)) { uniq.push(b); seen.add(b); } }

    if (!uniq.length) {
      // 最后兜底：避免整页容器，限定必须包含选择 DOM 或输入
      const fallback = Array.from(document.querySelectorAll('div,section,article')).filter(isQuestionBox);
      const out = []; const s2 = new Set();
      for (const b of fallback) { if (!s2.has(b)) { out.push(b); s2.add(b); } }
      return out;
    }
    return uniq;
  };
  const extractQuestion = (box, idx) => {
    const selectedRaw = extractSelected(box);
    const stdAnsRaw = extractStdAnswerByText(box);
    const htmlToText = v => {
      if (typeof v !== 'string') return v;
      const div = document.createElement('div');
      div.innerHTML = v;
      return normalizeText(div.textContent || v);
    };
    const clean = arr => Array.from(new Set(arr.map(htmlToText).filter(Boolean)));
    const selected = clean(selectedRaw);
    const stdAns = clean(stdAnsRaw);
    const mergedCorrect = clean([...stdAns, ...selected]);

    return {
      id: idx + 1,
      type: detectType(box),
      title: getQuestionTitle(box),
      options: extractOptions(box),
      correctAnswer: mergedCorrect,
      selectedAnswer: selected,
      images: extractImages(box)
    };
  };
  const isValidQuestion = q => {
    const hasOpts = Array.isArray(q.options) && q.options.length >= 2;
    const hasAns = Array.isArray(q.correctAnswer) && q.correctAnswer.length > 0;
    const hasSel = Array.isArray(q.selectedAnswer) && q.selectedAnswer.length > 0;
    const typeOk = q.type === '单选' || q.type === '多选' || q.type === '判断' || q.type === '填空';
    const t = (q.title || '').trim();
    const headers = (() => {
      const set = new Set();
      const sels = 'h1,h2,.paperTitle,.examTitle,.topTit,.header-title,.examName';
      document.querySelectorAll(sels).forEach(el => { const tx = normalizeText(el.textContent); if (tx) set.add(tx); });
      const dt = normalizeText(document.title); if (dt) set.add(dt);
      return set;
    })();
    if (headers.has(t)) return false;
    const looksLikeHeader = /试卷|期末|复习题|考试|作业|章节|题库$/.test(t) && !hasOpts && !hasAns && !hasSel;
    if (looksLikeHeader) return false;
    if (q.type === '填空') return (hasSel || hasAns || t.length > 0);
    return typeOk && (hasOpts || hasAns || hasSel);
  };
  const scanQuestions = () => collectBoxes().map((b, i) => extractQuestion(b, i)).filter(isValidQuestion);
  const toCSV = data => {
    const esc = s => \`"\${String(s).replace(/"/g,'""')}"\`;
    const rows = [["题号","题型","题目","选项","正确答案","用户答案","图片"]];
    data.forEach(q => { const opts = (q.options||[]).map(o=>\`\${o.label}.\${o.text}\`).join(" | "); const std = (q.correctAnswer||[]).join(" | "); const sel = (q.selectedAnswer||[]).join(" | "); const imgs = (q.images||[]).join(" | "); rows.push([q.id,q.type,q.title,opts,std,sel,imgs]); });
    return rows.map(r => r.map(esc).join(",")).join("\\n");
  };
  const download = (filename, content, type="application/json") => {
    if (typeof GM_download === "function") { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); GM_download({ url, name: filename }); setTimeout(()=>URL.revokeObjectURL(url), 10000); return; }
    const a = document.createElement("a"); a.download = filename; a.href = URL.createObjectURL(new Blob([content], { type })); document.body.appendChild(a); a.click(); a.remove();
  };
  const ensureUI = () => {
    if (document.getElementById("cx-scraper-panel")) return;
    const wrap = document.createElement("div"); wrap.id = "cx-scraper-panel";
    wrap.innerHTML = \`<button data-act="copy">复制JSON</button><button data-act="json">下载JSON</button><button data-act="csv">下载CSV</button><button data-act="rescan">重新扫描</button>\`;
    document.body.appendChild(wrap);
    GM_addStyle(\`#cx-scraper-panel{position:fixed;right:16px;bottom:16px;z-index:99999;background:#111a;color:#fff;padding:10px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.3);display:flex;gap:8px;flex-wrap:wrap}#cx-scraper-panel button{background:#2b6;color:#fff;border:none;padding:6px 10px;border-radius:6px;cursor:pointer}#cx-scraper-panel button:hover{background:#1a4}\`);
    wrap.addEventListener("click", e => {
      const btn = e.target.closest("button"); if (!btn) return;
      const act = btn.getAttribute("data-act"); const data = scanQuestions();
      if (act === "copy") { const json = JSON.stringify({ source: location.href, ts: Date.now(), items: data }, null, 2); if (typeof GM_setClipboard === "function") GM_setClipboard(json); else navigator.clipboard && navigator.clipboard.writeText(json); }
      else if (act === "json") { const json = JSON.stringify({ source: location.href, ts: Date.now(), items: data }, null, 2); download(\`chaoxing_work_\${Date.now()}.json\`, json, "application/json"); }
      else if (act === "csv") { const csv = toCSV(data); download(\`chaoxing_work_\${Date.now()}.csv\`, csv, "text/csv"); }
    });
    GM_registerMenuCommand("打开面板", () => wrap.style.display = "flex");
  };
  const ready = () => { if (document.body) { ensureUI(); } else { const t = setInterval(()=>{ if (document.body){ clearInterval(t); ensureUI(); } }, 200); } };
  ready();
})();
`;

const PYTHON_BANK_QUESTIONS = [
  {"id":1,"type":"单选","title":"1. (单选题, 1.0 points) Python语言属于以下哪种语言?( )","options":[{"label":"A","text":"机器语言"},{"label":"B","text":"汇编语言"},{"label":"C","text":"高级语言"},{"label":"D","text":"以上都不是"}],"correctAnswer":["高级语言"],"selectedAnswer":["高级语言"],"images":[]},
  {"id":2,"type":"单选","title":"2. (单选题, 1.0 points) 下列不属于Python特性的是哪一项?( )","options":[{"label":"A","text":"简单、易学"},{"label":"B","text":"开源的、免费的"},{"label":"C","text":"属于低级语言"},{"label":"D","text":"具有高可移植性"}],"correctAnswer":["属于低级语言"],"selectedAnswer":["属于低级语言"],"images":[]},
  {"id":3,"type":"单选","title":"3. (单选题, 1.0 points) 下列计算机语言中,不属于解释型语言的是哪一项?( )","options":[{"label":"A","text":"Python"},{"label":"B","text":"JavaScript"},{"label":"C","text":"C++"},{"label":"D","text":"HTML"}],"correctAnswer":["C++"],"selectedAnswer":["C++"],"images":[]},
  {"id":4,"type":"单选","title":"4. (单选题, 1.0 points) 下列哪方面的应用,不适合使用Python开发?( )","options":[{"label":"A","text":"科学运算"},{"label":"B","text":"系统运维"},{"label":"C","text":"网站设计"},{"label":"D","text":"数据库编程"}],"correctAnswer":["网站设计"],"selectedAnswer":["网站设计"],"images":[]},
  {"id":5,"type":"单选","title":"5. (单选题, 1.0 points) 下列关于Python版本的说法中,正确的是哪一项?( )","options":[{"label":"A","text":"目前存在Python 3.x兼容Python 2.x版本的程序"},{"label":"B","text":"Python 2.x版本需要升级到Python 3.x版本才能使用"},{"label":"C","text":"目前Python 2.x版本还会发布新版本"},{"label":"D","text":"Python 2.x和Python 3.x是两个不兼容的版本"}],"correctAnswer":["Python 2.x和Python 3.x是两个不兼容的版本"],"selectedAnswer":["Python 2.x和Python 3.x是两个不兼容的版本"],"images":[]},
  {"id":6,"type":"单选","title":"6. (单选题, 1.0 points) Python脚本文件的扩展名是哪一项?( )","options":[{"label":"A","text":".pyc"},{"label":"B","text":".py"},{"label":"C","text":".pt"},{"label":"D","text":".pyw"}],"correctAnswer":[".py"],"selectedAnswer":[".py"],"images":[]},
  {"id":7,"type":"单选","title":"7. (单选题, 1.0 points) Python内置的集成开发环境是哪一项?( )","options":[{"label":"A","text":"PyCharm"},{"label":"B","text":"Pydev"},{"label":"C","text":"IDLE"},{"label":"D","text":"pip"}],"correctAnswer":["IDLE"],"selectedAnswer":["IDLE"],"images":[]},
  {"id":8,"type":"单选","title":"8. (单选题, 1.0 points) 以下关于Python语言的描述中,不正确的是哪一项?( )","options":[{"label":"A","text":"Python语言编写的程序比大部分编程语言编写的程序更为简洁"},{"label":"B","text":"Python语言主要是用于系统编程和Web开发的语言"},{"label":"C","text":"Python语言是解释执行的,执行速度比编译型语言慢"},{"label":"D","text":"Python程序要实现更高的执行速度,例如数值计算或动画,可以调用C语言编写的代码"}],"correctAnswer":["Python语言主要是用于系统编程和Web开发的语言"],"selectedAnswer":["Python语言主要是用于系统编程和Web开发的语言"],"images":[]},
  {"id":9,"type":"单选","title":"9. (单选题, 1.0 points) 以下关于计算机语言的描述中,不正确的是哪一项?( )","options":[{"label":"A","text":"解释是将源代码逐条转换成目标代码并同时逐条运行目标代码的过程"},{"label":"B","text":"C语言是静态编译语言,Python语言是脚本语言"},{"label":"C","text":"编译是将源代码转换成目标代码的过程"},{"label":"D","text":"静态语言采用解释方式执行,脚本语言采用编译方式执行"}],"correctAnswer":["静态语言采用解释方式执行,脚本语言采用编译方式执行"],"selectedAnswer":["静态语言采用解释方式执行,脚本语言采用编译方式执行"],"images":[]},
  {"id":10,"type":"单选","title":"10. (单选题, 1.0 points) 以下关于部署Python环境、运行Python程序的操作系统环境的描述中,不正确的是哪一项?( )","options":[{"label":"A","text":"不同的操作系统均可以"},{"label":"B","text":"Linux操作系统可以"},{"label":"C","text":"macOS操作系统不可以"},{"label":"D","text":"Windows操作系统可以"}],"correctAnswer":["macOS操作系统不可以"],"selectedAnswer":["macOS操作系统不可以"],"images":[]},
  {"id":11,"type":"单选","title":"11. (单选题, 1.0 points) 下列选项中,不是Python关键字的是哪一项?()","options":[{"label":"A","text":"pass"},{"label":"B","text":"from"},{"label":"C","text":"yield"},{"label":"D","text":"static"}],"correctAnswer":["static"],"selectedAnswer":["static"],"images":[]},
  {"id":12,"type":"单选","title":"12. (单选题, 1.0 points) 下列选项中,可作为Python标识符的是哪一项?( )","options":[{"label":"A","text":"getpath()"},{"label":"B","text":"throw"},{"label":"C","text":"my#var"},{"label":"D","text":"_My _price"}],"correctAnswer":["throw"],"selectedAnswer":["throw"],"images":[]},
  {"id":13,"type":"单选","title":"13. (单选题, 1.0 points) 下列选项中,使用bool()函数测试,值不是False的是哪一项?( )","options":[{"label":"A","text":"0"},{"label":"B","text":"[]"},{"label":"C","text":"{}"},{"label":"D","text":"−1"}],"correctAnswer":["−1"],"selectedAnswer":["−1"],"images":[]},
  {"id":14,"type":"单选","title":"14. (单选题, 1.0 points) 假设x、y、z的值都是0,下列表达式中非法的是哪一项?( )","options":[{"label":"A","text":"x=y=z=2"},{"label":"B","text":"x,y=y,x"},{"label":"C","text":"x=(y==z+1)"},{"label":"D","text":"x=(y=z+1)"}],"correctAnswer":["x=(y=z+1)"],"selectedAnswer":["x=(y=z+1)"],"images":[]},
  {"id":15,"type":"单选","title":"15. (单选题, 1.0 points) 下列关于字符串的定义中,错误的是哪一项?( )","options":[{"label":"A","text":"'''hipython'''"},{"label":"B","text":"'hipython'"},{"label":"C","text":"\"hipython\""},{"label":"D","text":"[hipython]"}],"correctAnswer":["[hipython]"],"selectedAnswer":["[hipython]"],"images":[]},
  {"id":16,"type":"单选","title":"16. (单选题, 1.0 points) 下列数据类型中,Python不支持的是哪一项?( )","options":[{"label":"A","text":"char"},{"label":"B","text":"int"},{"label":"C","text":"float"},{"label":"D","text":"list"}],"correctAnswer":["char"],"selectedAnswer":["char"],"images":[]},
  {"id":17,"type":"单选","title":"17. (单选题, 1.0 points) Python 语句 print(type(1/2))的输出结果是哪一项?( )","options":[{"label":"A","text":"class <'int'>"},{"label":"B","text":"class <'number'>"},{"label":"C","text":"class <'float'>"},{"label":"D","text":"class <'double'>"}],"correctAnswer":["class <'float'>"],"selectedAnswer":["class <'float'>"],"images":[]},
  {"id":18,"type":"单选","title":"18. (单选题, 1.0 points) Python语句x='car';y=2;print(x+y)的输出结果是哪一项?( )","options":[{"label":"A","text":"语法错"},{"label":"B","text":"2"},{"label":"C","text":"car2"},{"label":"D","text":"catcar"}],"correctAnswer":["语法错"],"selectedAnswer":["语法错"],"images":[]},
  {"id":19,"type":"单选","title":"19. (单选题, 1.0 points) Python 语句 print(0.1+0.2==0.3)的输出结果是哪一项?( )","options":[{"label":"A","text":"True"},{"label":"B","text":"False"},{"label":"C","text":"−1"},{"label":"D","text":"0"}],"correctAnswer":["False"],"selectedAnswer":["False"],"images":[]},
  {"id":20,"type":"单选","title":"20. (单选题, 1.0 points) 以下语句的输出结果是哪一项?( ) a=10.99 print(complex(a))","options":[{"label":"A","text":"0.99"},{"label":"B","text":"10.99+j"},{"label":"C","text":"10.99"},{"label":"D","text":"(10.99+0j)"}],"correctAnswer":["(10.99+0j)"],"selectedAnswer":["(10.99+0j)"],"images":[]},
  {"id":21,"type":"单选","title":"21. (单选题, 1.0 points) 以下关于Python语言浮点数类型的描述中,不正确的是哪一项?( )","options":[{"label":"A","text":"Python语言要求所有浮点数必须带有小数部分"},{"label":"B","text":"浮点数类型表示带有小数的类型"},{"label":"C","text":"小数部分不可以为0"},{"label":"D","text":"浮点数类型与数学中实数的概念一致"}],"correctAnswer":["小数部分不可以为0"],"selectedAnswer":["小数部分不可以为0"],"images":[]},
  {"id":22,"type":"单选","title":"22. (单选题, 1.0 points) Python的运算符中**的作用是哪一项?()","options":[{"label":"A","text":"非法符号"},{"label":"B","text":"幂运算"},{"label":"C","text":"乘法运算"},{"label":"D","text":"操作数取平方"}],"correctAnswer":["幂运算"],"selectedAnswer":["幂运算"],"images":[]},
  {"id":23,"type":"单选","title":"23. (单选题, 1.0 points) 下列关于字符串的表述中,不合法的是哪一项?( )","options":[{"label":"A","text":"'''python'''"},{"label":"B","text":"[python]"},{"label":"C","text":"\"p'yth'on\""},{"label":"D","text":"'py\"th\"on'"}],"correctAnswer":["[python]"],"selectedAnswer":["[python]"],"images":[]},
  {"id":24,"type":"单选","title":"24. (单选题, 1.0 points) 下列代码的输出结果是哪一项?( ) print(\"数量{1},单价{0}\".format(23.4,34.2))","options":[{"label":"A","text":"数量34.2,单价23.4"},{"label":"B","text":"数量,单价34.2"},{"label":"C","text":"数量34,单价23"},{"label":"D","text":"数量23,单价34"}],"correctAnswer":["数量34.2,单价23.4"],"selectedAnswer":["数量34.2,单价23.4"],"images":[]},
  {"id":25,"type":"单选","title":"25. (单选题, 1.0 points) 下列代码的输出结果是哪一项?( ) print('a'.rjust(10,\"*\"))","options":[{"label":"A","text":"a*********"},{"label":"B","text":"*********a"},{"label":"C","text":"aaaaaaaaaa"},{"label":"D","text":"a*(前有9个空格)"}],"correctAnswer":["*********a"],"selectedAnswer":["*********a"],"images":[]},
  {"id":26,"type":"单选","title":"26. (单选题, 1.0 points) 下列代码的输出结果是哪一项?( ) >>> str1=\"helloPython\" >>> min(str1)","options":[{"label":"A","text":"y"},{"label":"B","text":"P"},{"label":"C","text":"e"},{"label":"D","text":"运行异常"}],"correctAnswer":["P"],"selectedAnswer":["P"],"images":[]},
  {"id":27,"type":"单选","title":"27. (单选题, 1.0 points) 关于表达式id(\"45\")结果的描述,不正确的是哪一项?( )","options":[{"label":"A","text":"是一个字符串"},{"label":"B","text":"是一个正整数"},{"label":"C","text":"可能是46319680"},{"label":"D","text":"是\"45\"的内存地址"}],"correctAnswer":["是一个字符串"],"selectedAnswer":["是一个字符串"],"images":[]},
  {"id":28,"type":"单选","title":"28. (单选题, 1.0 points) 设str1=\"*@python@*\",语句print(str1[2:].strip(\"@\"))的执行结果是哪一项?( )","options":[{"label":"A","text":"*@python@*"},{"label":"B","text":"python*"},{"label":"C","text":"python@*"},{"label":"D","text":"*python*"}],"correctAnswer":["python@*"],"selectedAnswer":["python@*"],"images":[]},
  {"id":29,"type":"单选","title":"29. (单选题, 1.0 points) 设str1=\"python\",语句print(str1.center(10,\"*\"))的执行结果是哪一项?( )","options":[{"label":"A","text":"**python**"},{"label":"B","text":"python****"},{"label":"C","text":"****python"},{"label":"D","text":"SyntaxError"}],"correctAnswer":["**python**"],"selectedAnswer":["**python**"],"images":[]},
  {"id":30,"type":"单选","title":"30. (单选题, 1.0 points) 字符串tstr=\"television\",显示结果为vi的选项是哪一项?( )","options":[{"label":"A","text":"print(tstr[-6:6])"},{"label":"B","text":"print(tstr[5:7])"},{"label":"C","text":"print(tstr[4:7])"},{"label":"D","text":"print(tstr[4:-2])"}],"correctAnswer":["print(tstr[-6:6])"],"selectedAnswer":["print(tstr[-6:6])"],"images":[]},
  {"id":31,"type":"单选","title":"31. (单选题, 1.0 points) 以下关于Python字符串的描述中,不正确的是哪一项?( )","options":[{"label":"A","text":"字符串可以表示为\"\"或' '"},{"label":"B","text":"Python的字符串中可以混合使用正整数和负整数进行索引和切片"},{"label":"C","text":"字符串'my\\\\text.dat'中第一个\\表示转义符"},{"label":"D","text":"Python字符串采用[N:M]格式进行切片,获取字符串从索引N到M的子字符串(包含N和M)"}],"correctAnswer":["Python字符串采用[N:M]格式进行切片,获取字符串从索引N到M的子字符串(包含N和M)"],"selectedAnswer":["Python字符串采用[N:M]格式进行切片,获取字符串从索引N到M的子字符串(包含N和M)"],"images":[]},
  {"id":32,"type":"单选","title":"32. (单选题, 1.0 points) 表达式eval(\"500//10\")的结果是哪一项?( )","options":[{"label":"A","text":"500/10"},{"label":"B","text":"50.0"},{"label":"C","text":"50"},{"label":"D","text":"\"500//10\""}],"correctAnswer":["50"],"selectedAnswer":["50"],"images":[]},
  {"id":33,"type":"单选","title":"33. (单选题, 1.0 points) 下列选项中,不属于Python循环结构的是哪一项?( )","options":[{"label":"A","text":"for循环"},{"label":"B","text":"while循环"},{"label":"C","text":"do…while循环"},{"label":"D","text":"嵌套的while循环"}],"correctAnswer":["do…while循环"],"selectedAnswer":["do…while循环"],"images":[]},
  {"id":34,"type":"单选","title":"34. (单选题, 1.0 points) 以下代码段,运行结果正确的是哪一项?( ) x=2 y=2.0 if x==y: print(\"Equal\") else: print(\"Not Equal\")","options":[{"label":"A","text":"Equal"},{"label":"B","text":"Not Equal"},{"label":"C","text":"运行异常"},{"label":"D","text":"以上结果都不对"}],"correctAnswer":["Equal"],"selectedAnswer":["Equal"],"images":[]},
  {"id":35,"type":"单选","title":"35. (单选题, 1.0 points) 以下代码段,运行结果正确的是哪一项?( ) x=2 if x: print(True) else: print(False)","options":[{"label":"A","text":"True"},{"label":"B","text":"False"},{"label":"C","text":"运行异常"},{"label":"D","text":"以上结果都不对"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":36,"type":"单选","title":"36. (单选题, 1.0 points) 关于下面代码的叙述,正确的是哪一项?( ) x=0 while x<10: x+=1 print(x) if x>3: break","options":[{"label":"A","text":"代码编译异常"},{"label":"B","text":"输出:0 1 2"},{"label":"C","text":"输出:1 2 3"},{"label":"D","text":"输出:1 2 3 4"}],"correctAnswer":["输出:1 2 3 4"],"selectedAnswer":["输出:1 2 3 4"],"images":[]},
  {"id":37,"type":"单选","title":"37. (单选题, 1.0 points) 以下代码段,运行结果正确的是哪一项?( ) for i in range(4): if i==3: break print(i) print(i)","options":[{"label":"A","text":"0123"},{"label":"B","text":"0122"},{"label":"C","text":"123"},{"label":"D","text":"234"}],"correctAnswer":["0123"],"selectedAnswer":["0123"],"images":[]},
  {"id":38,"type":"单选","title":"38. (单选题, 1.0 points) 以下代码段,运行结果正确的是哪一项?( ) a=17 b=6 result=a%b if(a%b>4) else a/b print(result)","options":[{"label":"A","text":"0"},{"label":"B","text":"1"},{"label":"C","text":"2"},{"label":"D","text":"5"}],"correctAnswer":["5"],"selectedAnswer":["5"],"images":[]},
  {"id":39,"type":"单选","title":"39. (单选题, 1.0 points) 以下代码段,运行结果正确的是哪一项?( ) i =3 j =0 k=3.2 if(i< k): if( i== j): print(i) else: print(j) else: print(k)","options":[{"label":"A","text":"3"},{"label":"B","text":"0"},{"label":"C","text":"3.2"},{"label":"D","text":"以上结果都不对"}],"correctAnswer":["0"],"selectedAnswer":["0"],"images":[]},
  {"id":40,"type":"单选","title":"40. (单选题, 1.0 points) 下列选项的功能是求两个数值x、y中的最大数,不正确的是哪一项?( )","options":[{"label":"A","text":"result=x if x>y else y"},{"label":"B","text":"result=max(x,y)"},{"label":"C","text":"if x>y:result=x else:result=y"},{"label":"D","text":"if y>=x:result=y result=x"}],"correctAnswer":["if y>=x:result=y result=x"],"selectedAnswer":["if y>=x:result=y result=x"],"images":[]},
  {"id":41,"type":"单选","title":"41. (单选题, 1.0 points) 在Python中,使用for…in方式形成的循环不能遍历的类型是哪一项?( )","options":[{"label":"A","text":"字典"},{"label":"B","text":"列表"},{"label":"C","text":"整数"},{"label":"D","text":"字符串"}],"correctAnswer":["整数"],"selectedAnswer":["整数"],"images":[]},
  {"id":42,"type":"单选","title":"42. (单选题, 1.0 points) 以下关于Python循环结构的描述中,错误的是哪一项?( )","options":[{"label":"A","text":"continue语句只结束本次循环"},{"label":"B","text":"遍历循环中的遍历结构可以是字符串、文件、组合数据类型和range()函数等"},{"label":"C","text":"Python使用for、while等保留字构建循环结构"},{"label":"D","text":"break语句用来结束当前当次语句,不跳出当前的循环体"}],"correctAnswer":["break语句用来结束当前当次语句,不跳出当前的循环体"],"selectedAnswer":["break语句用来结束当前当次语句,不跳出当前的循环体"],"images":[]},
  {"id":43,"type":"单选","title":"43. (单选题, 1.0 points) 以下关于“for in ”的描述,不正确的是哪一项?( )","options":[{"label":"A","text":"上面的循环体中不能有break语句,会影响循环次数"},{"label":"B","text":"使用 [1,2,3]和 ['1','2','3'],循环次数是一样的"},{"label":"C","text":"使用range(a,b)函数指定for循环的循环变量取值是a到b−1"},{"label":"D","text":"for i in range(1,10,2)表示循环5次,i的值是从1到9的奇数"}],"correctAnswer":["上面的循环体中不能有break语句,会影响循环次数"],"selectedAnswer":["上面的循环体中不能有break语句,会影响循环次数"],"images":[]},
  {"id":44,"type":"单选","title":"44. (单选题, 1.0 points) 以下代码的运行结果是哪一项?( ) s=\"北京,上海,广州,深圳,\" print(s.strip(\",\").replace(\",\",\";\"))","options":[{"label":"A","text":"北京 上海 广州 深圳"},{"label":"B","text":"北京;上海;广州;深圳,"},{"label":"C","text":"北京;上海;广州;深圳;"},{"label":"D","text":"北京;上海;广州;深圳"}],"correctAnswer":["北京;上海;广州;深圳"],"selectedAnswer":["北京;上海;广州;深圳"],"images":[]},
  {"id":45,"type":"单选","title":"45. (单选题, 1.0 points) 下列选项中,不属于字典操作的方法是哪一项?( )","options":[{"label":"A","text":"dicts.keys()"},{"label":"B","text":"dicts.pop()"},{"label":"C","text":"dicts.values()"},{"label":"D","text":"dicts.items()"}],"correctAnswer":["dicts.pop()"],"selectedAnswer":["dicts.pop()"],"images":[]},
  {"id":46,"type":"单选","title":"46. (单选题, 1.0 points) Python语句 temp=['a','1',2,3,None,]; print(len(temp)) 的输出结果是哪一项?( )","options":[{"label":"A","text":"3"},{"label":"B","text":"4"},{"label":"C","text":"5"},{"label":"D","text":"6"}],"correctAnswer":["5"],"selectedAnswer":["5"],"images":[]},
  {"id":47,"type":"单选","title":"47. (单选题, 1.0 points) Python语句temp=set([1,2,3,2,3,4,5]); print(len(temp)) 的输出结果是哪一项?( )","options":[{"label":"A","text":"7"},{"label":"B","text":"1"},{"label":"C","text":"4"},{"label":"D","text":"5"}],"correctAnswer":["5"],"selectedAnswer":["5"],"images":[]},
  {"id":48,"type":"单选","title":"48. (单选题, 1.0 points) 执行下面的操作后,lst的值是多少?( ) lst1=[3,4,5,6] lst2=lst1 lst1[2]=100 print(lst2)","options":[{"label":"A","text":"[3,4,5,6]"},{"label":"B","text":"[3,4,100,6]"},{"label":"C","text":"[3,100,5,6]"},{"label":"D","text":"[3,4,100,5,6]"}],"correctAnswer":["[3,4,100,6]"],"selectedAnswer":["[3,4,100,6]"],"images":[]},
  {"id":49,"type":"单选","title":"49. (单选题, 1.0 points) 下列选项中,正确定义了一个字典的是哪个选项?( )","options":[{"label":"A","text":"a=[a',1,b',2,'c,3]"},{"label":"B","text":"d=('a':1, 'b':2, 'c':3)"},{"label":"C","text":"{\"a\":1,\"b\":2,\"c\":3}"},{"label":"D","text":"d={'a':1, 'b':2, 'c':3}"}],"correctAnswer":["d={'a':1, 'b':2, 'c':3}"],"selectedAnswer":["d={'a':1, 'b':2, 'c':3}"],"images":[]},
  {"id":50,"type":"单选","title":"50. (单选题, 1.0 points) 下列选项中,不能使用索引运算的是哪一项?( )","options":[{"label":"A","text":"列表(list)"},{"label":"B","text":"元组(tuple)"},{"label":"C","text":"集合(set)"},{"label":"D","text":"字符串(str)"}],"correctAnswer":["集合(set)"],"selectedAnswer":["集合(set)"],"images":[]},
  {"id":51,"type":"单选","title":"51. (单选题, 1.0 points) 下列关于列表的说法中,错误的是哪一项?( )","options":[{"label":"A","text":"列表是一个有序集合,可以添加或删除元素"},{"label":"B","text":"列表可以存放任意类型的元素"},{"label":"C","text":"使用列表时,其下标可以是负数"},{"label":"D","text":"列表是不可变的数据结构"}],"correctAnswer":["列表是不可变的数据结构"],"selectedAnswer":["列表是不可变的数据结构"],"images":[]},
  {"id":52,"type":"单选","title":"52. (单选题, 1.0 points) Python语句 s={'a',1,'b',2};print(s[])的输出结果是哪一项?( )","options":[{"label":"A","text":"2"},{"label":"B","text":"1"},{"label":"C","text":"'b'"},{"label":"D","text":"语法错误"}],"correctAnswer":["语法错误"],"selectedAnswer":["语法错误"],"images":[]},
  {"id":53,"type":"单选","title":"53. (单选题, 1.0 points) 以下代码的输出结果是哪一项?( ) d={\"food\":{\"cake\":1,\"egg\":5}} print(d.get(\"cake\",\"no this food\") )","options":[{"label":"A","text":"no this food"},{"label":"B","text":"egg"},{"label":"C","text":"1"},{"label":"D","text":"food"}],"correctAnswer":["no this food"],"selectedAnswer":["no this food"],"images":[]},
  {"id":54,"type":"单选","title":"54. (单选题, 1.0 points) 以下代码的输出结果是哪一项?( ) s=[4,2,9,1] s.insert(2,3) print(s)","options":[{"label":"A","text":"[4,2,9,2,1]"},{"label":"B","text":"[4,2,3,9,1]"},{"label":"C","text":"[4,3,2,9,1]"},{"label":"D","text":"[4,2,9,1,2,3]"}],"correctAnswer":["[4,2,3,9,1]"],"selectedAnswer":["[4,2,3,9,1]"],"images":[]},
  {"id":55,"type":"单选","title":"55. (单选题, 1.0 points) 下列说法中,不正确的是哪一项?( )","options":[{"label":"A","text":"Python的str、tuple、list类型都属于序列类型"},{"label":"B","text":"组合数据类型可以分为3类:序列类型、集合类型和映射类型"},{"label":"C","text":"组合数据类型能够将多个数据组织起来,通过单一的表示使数据操作更有序,更容易理解"},{"label":"D","text":"序列类型是二维元素向量,元素之间存在先后关系,通过序号访问"}],"correctAnswer":["序列类型是二维元素向量,元素之间存在先后关系,通过序号访问"],"selectedAnswer":["序列类型是二维元素向量,元素之间存在先后关系,通过序号访问"],"images":[]},
  {"id":56,"type":"单选","title":"56. (单选题, 1.0 points) 下列关于列表变量ls的方法的说法中,不正确的是哪一项?( )","options":[{"label":"A","text":"ls.append(x):在列表ls最后增加一个元素x"},{"label":"B","text":"ls.clear():删除列表ls中的最后一个元素"},{"label":"C","text":"ls.copy():复制生成一个包括ls中所有元素的新列表"},{"label":"D","text":"ls.reverse():反转列表ls中的元素"}],"correctAnswer":["ls.clear():删除列表ls中的最后一个元素"],"selectedAnswer":["ls.clear():删除列表ls中的最后一个元素"],"images":[]},
  {"id":57,"type":"单选","title":"57. (单选题, 1.0 points) 可以用来创建 Python自定义函数的关键字是哪一项?( )","options":[{"label":"A","text":"function"},{"label":"B","text":"def"},{"label":"C","text":"class"},{"label":"D","text":"return"}],"correctAnswer":["def"],"selectedAnswer":["def"],"images":[]},
  {"id":58,"type":"单选","title":"58. (单选题, 1.0 points) 关于Python函数参数的描述中,不正确的是哪一项?( )","options":[{"label":"A","text":"Python实行按值传递参数,值传递是指调用函数时将常量或变量的值传递给函数的参数"},{"label":"B","text":"实参与形参分别存储在各自的内存空间中,是两个不相关的独立变量"},{"label":"C","text":"在函数内部改变形参的值时,实参的值一般是不会改变的"},{"label":"D","text":"实参与形参的名字必须相同"}],"correctAnswer":["实参与形参的名字必须相同"],"selectedAnswer":["实参与形参的名字必须相同"],"images":[]},
  {"id":59,"type":"单选","title":"59. (单选题, 1.0 points) 下列哪一项不属于函数的参数类型?( )","options":[{"label":"A","text":"位置参数"},{"label":"B","text":"默认参数"},{"label":"C","text":"可变参数"},{"label":"D","text":"地址参数"}],"correctAnswer":["地址参数"],"selectedAnswer":["地址参数"],"images":[]},
  {"id":60,"type":"单选","title":"60. (单选题, 1.0 points) Python语句f=lambda x,y:x*y; f(2,6)的运行结果是哪一项?( )","options":[{"label":"A","text":"2"},{"label":"B","text":"6"},{"label":"C","text":"12"},{"label":"D","text":"8"}],"correctAnswer":["12"],"selectedAnswer":["12"],"images":[]},
  {"id":61,"type":"单选","title":"61. (单选题, 1.0 points) 下列程序的运行结果是哪一项?( ) s=\"hello\" def setstr(): s=\"hi\" s+=\"world\" setstr() print(s)","options":[{"label":"A","text":"hi"},{"label":"B","text":"hello"},{"label":"C","text":"hiworld"},{"label":"D","text":"helloworld"}],"correctAnswer":["hello"],"selectedAnswer":["hello"],"images":[]},
  {"id":62,"type":"单选","title":"62. (单选题, 1.0 points) 下列哪个函数不属于序列操作函数?( )","options":[{"label":"A","text":"map()"},{"label":"B","text":"reduce()"},{"label":"C","text":"filter()"},{"label":"D","text":"lambda"}],"correctAnswer":["lambda"],"selectedAnswer":["lambda"],"images":[]},
  {"id":63,"type":"单选","title":"63. (单选题, 1.0 points) 以下的函数定义中,不正确的是哪一项?( )","options":[{"label":"A","text":"def vfunc(a,b=2):"},{"label":"B","text":"def vfunc(a,b):"},{"label":"C","text":"def vfunc(a,*b):"},{"label":"D","text":"def vfunc(*a,b):"}],"correctAnswer":["def vfunc(*a,b):"],"selectedAnswer":["def vfunc(*a,b):"],"images":[]},
  {"id":64,"type":"单选","title":"64. (单选题, 1.0 points) 运行以下程序,输入fish520,输出结果是哪一项?( ) w=input() for x in w: if '0'<=x<='9': continue else: w.replace(x,\"\")","options":[{"label":"A","text":"fish520"},{"label":"B","text":"fish"},{"label":"C","text":"520"},{"label":"D","text":"520fish"}],"correctAnswer":["fish520"],"selectedAnswer":["fish520"],"images":[]},
  {"id":65,"type":"单选","title":"65. (单选题, 1.0 points) 运行以下程序,输出结果是哪一项?( ) def calu(x=3,y=2): return(x*y) a='abc' b=2 print(calu(a,b),end=\",\")","options":[{"label":"A","text":"abcabc,"},{"label":"B","text":"abcabc"},{"label":"C","text":"6"},{"label":"D","text":"abcabc,6"}],"correctAnswer":["abcabc,"],"selectedAnswer":["abcabc,"],"images":[]},
  {"id":66,"type":"单选","title":"66. (单选题, 1.0 points) Python中,用来描述一类相同或相似事物的共同属性的是哪一项?( )","options":[{"label":"A","text":"类"},{"label":"B","text":"对象"},{"label":"C","text":"方法"},{"label":"D","text":"数据区"}],"correctAnswer":["类"],"selectedAnswer":["类"],"images":[]},
  {"id":67,"type":"单选","title":"67. (单选题, 1.0 points) 关于类和对象的关系,描述正确的是哪一项?( )","options":[{"label":"A","text":"类是面向对象的基础"},{"label":"B","text":"类是现实世界中事物的描述"},{"label":"C","text":"对象是根据类创建的,并且一个类只能对应一个对象"},{"label":"D","text":"对象是类的实例,是具体的事物"}],"correctAnswer":["对象是类的实例,是具体的事物"],"selectedAnswer":["对象是类的实例,是具体的事物"],"images":[]},
  {"id":68,"type":"单选","title":"68. (单选题, 1.0 points) 构造方法的作用是哪一项?( )","options":[{"label":"A","text":"显示对象初始信息"},{"label":"B","text":"初始化类"},{"label":"C","text":"初始化对象"},{"label":"D","text":"引用对象"}],"correctAnswer":["初始化对象"],"selectedAnswer":["初始化对象"],"images":[]},
  {"id":69,"type":"单选","title":"69. (单选题, 1.0 points) Python中定义私有属性的方法是哪一项?( )","options":[{"label":"A","text":"使用 private关键字"},{"label":"B","text":"使用public关键字"},{"label":"C","text":"使用__XX__定义属性名"},{"label":"D","text":"使用__XX定义属性名"}],"correctAnswer":["使用__XX定义属性名"],"selectedAnswer":["使用__XX定义属性名"],"images":[]},
  {"id":70,"type":"单选","title":"70. (单选题, 1.0 points) 在以下C类继承A类和B类的格式中,正确的是哪一项?( )","options":[{"label":"A","text":"class C extends A, B:"},{"label":"B","text":"class C(A: B):"},{"label":"C","text":"class C(A, B):"},{"label":"D","text":"class C implements A, B:"}],"correctAnswer":["class C(A, B):"],"selectedAnswer":["class C(A, B):"],"images":[]},
  {"id":71,"type":"单选","title":"71. (单选题, 1.0 points) 下列选项中,用于标识为静态方法的是哪一项?( )","options":[{"label":"A","text":"@classmethod"},{"label":"B","text":"@staticmethod"},{"label":"C","text":"@instancemethod"},{"label":"D","text":"@privatemethod"}],"correctAnswer":["@staticmethod"],"selectedAnswer":["@staticmethod"],"images":[]},
  {"id":72,"type":"单选","title":"72. (单选题, 1.0 points) 关于下面程序的说法中,不正确的是哪一项?( ) class Hello: def __(self,id,color=\"yellow\"): self.id=id self.color=color def Hello(self,weight): return 20+weight #主程序 h=Hello(100) print(h.color)","options":[{"label":"A","text":"构造方法是__init__(self,id,color=\"yellow\")"},{"label":"B","text":"Hello(self,weight) 是成员方法"},{"label":"C","text":"代码h=Hello(100)无法通过编译"},{"label":"D","text":"print(h.color)语句的输出结果是yellow"}],"correctAnswer":["代码h=Hello(100)无法通过编译"],"selectedAnswer":["代码h=Hello(100)无法通过编译"],"images":[]},
  {"id":73,"type":"单选","title":"73. (单选题, 1.0 points) 下列导入模块的语句中,不正确的是哪一项?( )","options":[{"label":"A","text":"import numpy as np"},{"label":"B","text":"from numpy import * as np"},{"label":"C","text":"from numpy import *"},{"label":"D","text":"import matplotlib.pyplot"}],"correctAnswer":["from numpy import * as np"],"selectedAnswer":["from numpy import * as np"],"images":[]},
  {"id":74,"type":"单选","title":"74. (单选题, 1.0 points) 下列关于包的说明中,不正确的是哪一项?( )","options":[{"label":"A","text":"包的外层目录必须包含在Python的搜索路径中"},{"label":"B","text":"包的所有下级子目录都需要包含一个__init__.py文件"},{"label":"C","text":"包由模块、类和函数等组成"},{"label":"D","text":"包的扩展名是.py"}],"correctAnswer":["包的扩展名是.py"],"selectedAnswer":["包的扩展名是.py"],"images":[]},
  {"id":75,"type":"单选","title":"75. (单选题, 1.0 points) 下列哪个是Python的标准库?( )","options":[{"label":"A","text":"Turtle"},{"label":"B","text":"jieba"},{"label":"C","text":"PIL"},{"label":"D","text":"pyintaller"}],"correctAnswer":["Turtle"],"selectedAnswer":["Turtle"],"images":[]},
  {"id":76,"type":"单选","title":"76. (单选题, 1.0 points) 在Python语言中,能够处理图像的第三方库是哪一项?( )","options":[{"label":"A","text":"PIL"},{"label":"B","text":"pyserial"},{"label":"C","text":"requests"},{"label":"D","text":"pyinstaller"}],"correctAnswer":["PIL"],"selectedAnswer":["PIL"],"images":[]},
  {"id":77,"type":"单选","title":"77. (单选题, 1.0 points) 在Python语言中,用于数据分析的第三方库是哪一项?( )","options":[{"label":"A","text":"Django"},{"label":"B","text":"flask"},{"label":"C","text":"pandas"},{"label":"D","text":"PIL"}],"correctAnswer":["pandas"],"selectedAnswer":["pandas"],"images":[]},
  {"id":78,"type":"单选","title":"78. (单选题, 1.0 points) turtle画图结束后,让画面停顿,不立即关掉窗口的方法是哪一项?( )","options":[{"label":"A","text":"turtle.clear()"},{"label":"B","text":"turtle.setup()"},{"label":"C","text":"turtle.penup()"},{"label":"D","text":"turtle.done()"}],"correctAnswer":["turtle.done()"],"selectedAnswer":["turtle.done()"],"images":[]},
  {"id":79,"type":"单选","title":"79. (单选题, 1.0 points) 当文件不存在时,下列哪种模式在使用open()方法打开文件时会报异常?( )","options":[{"label":"A","text":"'r'"},{"label":"B","text":"'a'"},{"label":"C","text":"'w'"},{"label":"D","text":"'w+'"}],"correctAnswer":["'r'"],"selectedAnswer":["'r'"],"images":[]},
  {"id":80,"type":"单选","title":"80. (单选题, 1.0 points) file是文本文件对象,下列选项中,哪一项用于读取文件的一行?( )","options":[{"label":"A","text":"file.read()"},{"label":"B","text":"file.readline(80)"},{"label":"C","text":"file.readlines()"},{"label":"D","text":"file.readline()"}],"correctAnswer":["file.readline()"],"selectedAnswer":["file.readline()"],"images":[]},
  {"id":81,"type":"单选","title":"81. (单选题, 1.0 points) 下列方法中,用于获取文件当前目录的是哪一个选项?( )","options":[{"label":"A","text":"os.mkdir()"},{"label":"B","text":"os.listdir()"},{"label":"C","text":"os.getcwd()"},{"label":"D","text":"os.mkdir(path)"}],"correctAnswer":["os.getcwd()"],"selectedAnswer":["os.getcwd()"],"images":[]},
  {"id":82,"type":"单选","title":"82. (单选题, 1.0 points) 下列代码可以成功执行,则myfile.data文件的保存目录是哪一个选项?( ) open(\"myfile.data\",\"ab\")","options":[{"label":"A","text":"C盘根目录下"},{"label":"B","text":"由path路径指明"},{"label":"C","text":"Python安装目录下"},{"label":"D","text":"与程序文件在相同的目录下"}],"correctAnswer":["与程序文件在相同的目录下"],"selectedAnswer":["与程序文件在相同的目录下"],"images":[]},
  {"id":83,"type":"单选","title":"83. (单选题, 1.0 points) 下列说法中,不正确的是哪一项?( )","options":[{"label":"A","text":"以'w'模式打开一个可读/写的文件,如果文件存在会被覆盖"},{"label":"B","text":"使用write()方法写入文件时,数据会追加到文件的末尾"},{"label":"C","text":"使用read()方法可以一次性读取文件中的所有数据"},{"label":"D","text":"使用readlines()方法可以一次性读取文件中的所有数据"}],"correctAnswer":["使用write()方法写入文件时,数据会追加到文件的末尾"],"selectedAnswer":["使用write()方法写入文件时,数据会追加到文件的末尾"],"images":[]},
  {"id":84,"type":"单选","title":"84. (单选题, 1.0 points) 在读写CSV文件时,最不可能使用的字符串处理方法是哪一项?( )","options":[{"label":"A","text":"join()"},{"label":"B","text":"index()"},{"label":"C","text":"strip()"},{"label":"D","text":"split()"}],"correctAnswer":["index()"],"selectedAnswer":["index()"],"images":[]},
  {"id":85,"type":"单选","title":"85. (单选题, 1.0 points) 使用open()函数打开Windows操作系统的文件,路径名不正确的是哪一项?( )","options":[{"label":"A","text":"open(r\"d:\\Python\\a.txt\",'w')"},{"label":"B","text":"open(\"d:\\Python\\a.txt\",'w')"},{"label":"C","text":"open(\"d:/Python/a.txt\",'w')"},{"label":"D","text":"open(\"d:\\\\Python\\\\a.txt\",'w')"}],"correctAnswer":["open(\"d:\\Python\\a.txt\",'w')"],"selectedAnswer":["open(\"d:\\Python\\a.txt\",'w')"],"images":[]},
  {"id":86,"type":"单选","title":"86. (单选题, 1.0 points) 文件exam.txt与下面的程序在同一目录,其内容是一段文本:Learning Python,以下最可能的输出结果是哪一项?( ) fo=open(\"exam.txt\") print(fo) fo.close()","options":[{"label":"A","text":"Learning Python"},{"label":"B","text":"exam.txt"},{"label":"C","text":"exam"},{"label":"D","text":"<_io.textiowrapper>"}],"correctAnswer":["<_io.textiowrapper>"],"selectedAnswer":["<_io.textiowrapper>"],"images":[]},
  {"id":87,"type":"单选","title":"87. (单选题, 1.0 points) 在SQL中,实现分组查询的短语是哪一项?( )","options":[{"label":"A","text":"order by"},{"label":"B","text":"group by"},{"label":"C","text":"having"},{"label":"D","text":"asc"}],"correctAnswer":["group by"],"selectedAnswer":["group by"],"images":[]},
  {"id":88,"type":"单选","title":"88. (单选题, 1.0 points) 下列关于SQL语句中的短语的说法中,正确的是哪一项?( )","options":[{"label":"A","text":"必须是大写的字母"},{"label":"B","text":"必须是小写的字母"},{"label":"C","text":"大小写字母均可"},{"label":"D","text":"大小写字母不能混合使用"}],"correctAnswer":["大小写字母均可"],"selectedAnswer":["大小写字母均可"],"images":[]},
  {"id":89,"type":"单选","title":"89. (单选题, 1.0 points) “delete from s where 年龄>60”语句的功能是什么?( )","options":[{"label":"A","text":"从s表中删除年龄大于60岁的记录"},{"label":"B","text":"从s表中删除年龄大于60岁的首条记录"},{"label":"C","text":"删除s表"},{"label":"D","text":"删除s表的年龄列"}],"correctAnswer":["从s表中删除年龄大于60岁的记录"],"selectedAnswer":["从s表中删除年龄大于60岁的记录"],"images":[]},
  {"id":90,"type":"单选","title":"90. (单选题, 1.0 points) “update student set年龄=年龄+1”语句的功能是什么?( )","options":[{"label":"A","text":"将student表中的所有学生的年龄变为1岁"},{"label":"B","text":"给student表中的所有学生的年龄增加1岁"},{"label":"C","text":"给student表中当前记录的学生的年龄增加1岁"},{"label":"D","text":"将student表中当前记录的学生的年龄变为1岁"}],"correctAnswer":["给student表中的所有学生的年龄增加1岁"],"selectedAnswer":["给student表中的所有学生的年龄增加1岁"],"images":[]},
  {"id":91,"type":"单选","title":"91. (单选题, 1.0 points) 在Python中连接SQLite的test数据库,正确的代码是哪一项?( )","options":[{"label":"A","text":"conn= sqlite3.connect(\"e:\\db\\test\")"},{"label":"B","text":"conn= sqlite3.connect(\"e:/db/test\")"},{"label":"C","text":"conn= sqlite3.Connect(\"e:\\db\\test\")"},{"label":"D","text":"conn= sqlite3.Connect(\"e:/db/test\")"}],"correctAnswer":["conn= sqlite3.connect(\"e:/db/test\")"],"selectedAnswer":["conn= sqlite3.connect(\"e:/db/test\")"],"images":[]},
  {"id":92,"type":"单选","title":"92. (单选题, 1.0 points) 关于SQLite3的数据类型的说法中,不正确的是哪一项?( )","options":[{"label":"A","text":"在SQLite3数据库中,表的主键应为integer类型"},{"label":"B","text":"SQLite3的动态数据类型与其他数据库使用的静态类型是不兼容的"},{"label":"C","text":"SQLite3的表完全可以不声明列的类型"},{"label":"D","text":"SQLite3的动态的数据类型是指根据列值自动判断列的数据类型"}],"correctAnswer":["在SQLite3数据库中,表的主键应为integer类型"],"selectedAnswer":["在SQLite3数据库中,表的主键应为integer类型"],"images":[]},
  {"id":93,"type":"单选","title":"93. (单选题, 1.0 points) 下列选项中,不属于Connect对象conn的方法是( )。","options":[{"label":"A","text":"conn.commit()"},{"label":"B","text":"conn.close()"},{"label":"C","text":"conn.execute()"},{"label":"D","text":"conn.open()"}],"correctAnswer":["conn.open()"],"selectedAnswer":["conn.open()"],"images":[]},
  {"id":94,"type":"单选","title":"94. (单选题, 1.0 points) 在代码import matplotlib.pyplot as plt中,plt的含义是什么?( )","options":[{"label":"A","text":"函数名"},{"label":"B","text":"类名"},{"label":"C","text":"库的别名"},{"label":"D","text":"变量名"}],"correctAnswer":["库的别名"],"selectedAnswer":["库的别名"],"images":[]},
  {"id":95,"type":"单选","title":"95. (单选题, 1.0 points) 以下哪个选项不是matplotlib.pyplot的绘图函数?( )","options":[{"label":"A","text":"hist()"},{"label":"B","text":"bar()"},{"label":"C","text":"pie()"},{"label":"D","text":"curve()"}],"correctAnswer":["curve()"],"selectedAnswer":["curve()"],"images":[]},
  {"id":96,"type":"单选","title":"96. (单选题, 1.0 points) 以下哪个选项不能生成一个ndarray对象?( )","options":[{"label":"A","text":"arr1 = np.array([0, 1, 2, 3, 4])"},{"label":"B","text":"arr2 = np.array({0:0,1:1,2:2,3:3,4:4})"},{"label":"C","text":"arr3 = np.array((0, 1, 2, 3, 4))"},{"label":"D","text":"arr4 = np.array(0, 1, 2, 3, 4)"}],"correctAnswer":["arr4 = np.array(0, 1, 2, 3, 4)"],"selectedAnswer":["arr4 = np.array(0, 1, 2, 3, 4)"],"images":[]},
  {"id":97,"type":"单选","title":"97. (单选题, 1.0 points) 下面代码中,savefig ()函数的作用是什么?( ) import matplotlib.pyplot as plt plt.plot([9,7, 15, 2, 9]) plt.savefig('test',dpi=600)","options":[{"label":"A","text":"将数据图存储为文件"},{"label":"B","text":"显示所绘制的数据图"},{"label":"C","text":"记录并存储数据"},{"label":"D","text":"刷新数据"}],"correctAnswer":["将数据图存储为文件"],"selectedAnswer":["将数据图存储为文件"],"images":[]},
  {"id":98,"type":"单选","title":"98. (单选题, 1.0 points) 下面代码运行后,数组arr的值是哪一项?( ) >>> import numpy as np >>> arr1=np.array([2,3,4]) >>> arr2=np.array([[1,1,1],[2,2,2],[3,3,3],[4,4,4]]) >>> arr=arr1*arr2","options":[{"label":"A","text":"array([[ 2,4,6 ,8], [ 3,6,9,12],[ 4,8,12,16]])"},{"label":"B","text":"array([[ 2,2,2], [ 6,6,6],[ 12,12,12], [4,4,4]])"},{"label":"C","text":"array( [[ 2,3,4], [ 4,6,8],[ 6,9,12], [ 8,12,16]]"},{"label":"D","text":"两个数组的行数不同,不能运算"}],"correctAnswer":["array( [[ 2,3,4], [ 4,6,8],[ 6,9,12], [ 8,12,16]]"],"selectedAnswer":["array( [[ 2,3,4], [ 4,6,8],[ 6,9,12], [ 8,12,16]]"],"images":[]},
  {"id":99,"type":"单选","title":"99. (单选题, 1.0 points) 下面代码的运行结果是哪一项?( ) >>>import numpy as np >>>arr1=np.array([[2,3,4],[1,2,3],[3,4,5]]) >>>np.transpose(arr1) >>>arr1.T","options":[{"label":"A","text":"array([[2,1,3], [3,2,4] ,[4,3,5]])array([[2,1,3], [3,2,4] ,[4,3,5]])"},{"label":"B","text":"array([[2,3,4],[1,2,3],[3,4,5]]) array([[2,3,4],[1,2,3],[3,4,5]])"},{"label":"C","text":"array([[2,1,3], [3,2,4] ,[4,3,5]])array([[2,3,4],[1,2,3],[3,4,5]])"},{"label":"D","text":"array([[2,1,3], [3,2,4] ,[4,3,5]]) array( [2,1,3,3,2,4, 4,3,5])"}],"correctAnswer":["array([[2,1,3], [3,2,4] ,[4,3,5]])array([[2,1,3], [3,2,4] ,[4,3,5]])"],"selectedAnswer":["array([[2,1,3], [3,2,4] ,[4,3,5]])array([[2,1,3], [3,2,4] ,[4,3,5]])"],"images":[]},
  {"id":100,"type":"单选","title":"100. (单选题, 1.0 points) 下面代码的运行结果是哪一项?( ) >>>arr=np.arange(-1,-10,-2) >>>arr[::-1]","options":[{"label":"A","text":"array([-9, -7, -5, -3, -1])"},{"label":"B","text":"array([-1, -3, -5, -7, -9])"},{"label":"C","text":"array([-2, -4, -6, -8, -10])"},{"label":"D","text":"array([-10, -8, -6, -4, -2])"}],"correctAnswer":["array([-9, -7, -5, -3, -1])"],"selectedAnswer":["array([-9, -7, -5, -3, -1])"],"images":[]},
  {"id":101,"type":"单选","title":"101. (单选题, 1.0 points) 以下哪个选项不是Python的Web应用框架?( )","options":[{"label":"A","text":"Flask"},{"label":"B","text":"Django"},{"label":"C","text":"Tornado"},{"label":"D","text":"urllib"}],"correctAnswer":["urllib"],"selectedAnswer":["urllib"],"images":[]},
  {"id":102,"type":"单选","title":"102. (单选题, 1.0 points) 第三方库beautifulsoup4的功能是哪一项?( )","options":[{"label":"A","text":"解析和处理HTML和XML"},{"label":"B","text":"支持Web应用程序框架"},{"label":"C","text":"支持Webservices框架"},{"label":"D","text":"处理HTTP请求"}],"correctAnswer":["解析和处理HTML和XML"],"selectedAnswer":["解析和处理HTML和XML"],"images":[]},
  {"id":103,"type":"单选","title":"103. (单选题, 1.0 points) 以下不属于网络爬虫领域的第三方库是哪一项?( )","options":[{"label":"A","text":"Scrapy"},{"label":"B","text":"SnowNLP"},{"label":"C","text":"Requests"},{"label":"D","text":"PySpider"}],"correctAnswer":["SnowNLP"],"selectedAnswer":["SnowNLP"],"images":[]},
  {"id":104,"type":"单选","title":"104. (单选题, 1.0 points) 下面是解析网页的一段代码,其中,soup是一个BeautifulSoup对象,最后一行代码中,变量str内容的功能是哪一项?( ) contents=soup.select('.hot') for items in contents: item=items.select('li') for i in item: str=i.a['href']","options":[{"label":"A","text":"超级链接的网址"},{"label":"B","text":"列表中的一个数据项"},{"label":"C","text":"超级链接的属性信息"},{"label":"D","text":"超级链接的格式信息"}],"correctAnswer":["超级链接的网址"],"selectedAnswer":["超级链接的网址"],"images":[]},
  {"id":105,"type":"单选","title":"105. (单选题, 1.0 points) requests.get()函数的返回值类型是哪一项?( )","options":[{"label":"A","text":"String"},{"label":"B","text":"text"},{"label":"C","text":"Response"},{"label":"D","text":"Request"}],"correctAnswer":["Response"],"selectedAnswer":["Response"],"images":[]},
  {"id":106,"type":"单选","title":"106. (单选题, 1.0 points) 下列关于异常处理的描述中,不正确的是哪一项?( )","options":[{"label":"A","text":"程序运行产生的异常由用户或者Python解释器进行处理"},{"label":"B","text":"使用try…except语句捕获异常"},{"label":"C","text":"使用raise语句抛出异常"},{"label":"D","text":"捕获到的异常只能在当前方法中处理,而不能在其他方法中处理"}],"correctAnswer":["捕获到的异常只能在当前方法中处理,而不能在其他方法中处理"],"selectedAnswer":["捕获到的异常只能在当前方法中处理,而不能在其他方法中处理"],"images":[]},
  {"id":107,"type":"单选","title":"107. (单选题, 1.0 points) 下列关于try…except…finally语句的描述中,正确的是哪一项?( )","options":[{"label":"A","text":"try语句后面的程序段将给出处理异常的语句"},{"label":"B","text":"except语句在try语句的后面,该语句可以不接异常名称"},{"label":"C","text":"except语句后的异常名称与异常类的含义是相同的"},{"label":"D","text":"finally语句后面的代码段不一定总是被执行的,如果抛出异常,该代码不执行"}],"correctAnswer":["except语句在try语句的后面,该语句可以不接异常名称"],"selectedAnswer":["except语句在try语句的后面,该语句可以不接异常名称"],"images":[]},
  {"id":108,"type":"单选","title":"108. (单选题, 1.0 points) 下列关于创建用户自定义异常的描述中,不正确的是哪一项?( )","options":[{"label":"A","text":"用户自定义异常需要继承Exception类或其他异常类"},{"label":"B","text":"在方法中声明抛出异常 关键字是throw语句"},{"label":"C","text":"捕捉异常的方法是使用try…except…else…finaIly语句"},{"label":"D","text":"使用异常处理会使整个系统更加安全和稳健"}],"correctAnswer":["在方法中声明抛出异常 关键字是throw语句"],"selectedAnswer":["在方法中声明抛出异常 关键字是throw语句"],"images":[]},
  {"id":109,"type":"单选","title":"109. (单选题, 1.0 points) 给定以下代码: def problem(): raise NameError def method1(): try: print(\"a\") problem() except NameError: print(\"b\") except Exception: print(\"c\") finally: print(\"d\") print(\"e\") method1() 当执行method1 ()方法后,输出结果是哪一项?( )","options":[{"label":"A","text":"acd"},{"label":"B","text":"abd"},{"label":"C","text":"abde"},{"label":"D","text":"a"}],"correctAnswer":["abde"],"selectedAnswer":["abde"],"images":[]},
  {"id":110,"type":"单选","title":"110. (单选题, 1.0 points) 下列选项中,不在运行时发生的异常是哪一项?( )","options":[{"label":"A","text":"ZerodivisionError"},{"label":"B","text":"NameError"},{"label":"C","text":"SyntaxError"},{"label":"D","text":"KeyError"}],"correctAnswer":["SyntaxError"],"selectedAnswer":["SyntaxError"],"images":[]},
  {"id":111,"type":"单选","title":"111. (单选题, 1.0 points) 当try语句块中没有任何错误信息时,一定不会执行的语句是哪一项?( )","options":[{"label":"A","text":"try"},{"label":"B","text":"else"},{"label":"C","text":"finally"},{"label":"D","text":"except"}],"correctAnswer":["except"],"selectedAnswer":["except"],"images":[]},
  {"id":112,"type":"单选","title":"112. (单选题, 1.0 points) 如果Python程序中试图打开不存在的文件,解释器将在运行时抛出哪类异常?( )","options":[{"label":"A","text":"NameError"},{"label":"B","text":"SyntaxError"},{"label":"C","text":"FileNotFoundError"},{"label":"D","text":"ZeroDivisionError"}],"correctAnswer":["FileNotFoundError"],"selectedAnswer":["FileNotFoundError"],"images":[]},
  {"id":113,"type":"单选","title":"113. (单选题, 1.0 points) Python程序中,假设列表s=[1,23,2],如果语句中使用s[3],则解释器将抛出哪类异常?( )","options":[{"label":"A","text":"NameError"},{"label":"B","text":"IndexError"},{"label":"C","text":"SyntaxError"},{"label":"D","text":"ZeroDivisionError"}],"correctAnswer":["IndexError"],"selectedAnswer":["IndexError"],"images":[]},
  {"id":114,"type":"单选","title":"114. (单选题, 1.0 points) Python程序中,假设字典d={'1':'male','2':'female'},如果语句中使用d[3],则解释器将抛出哪类异常?( )","options":[{"label":"A","text":"NameError"},{"label":"B","text":"IndexError"},{"label":"C","text":"SyntaxError"},{"label":"D","text":"KeyError"}],"correctAnswer":["KeyError"],"selectedAnswer":["KeyError"],"images":[]},
  {"id":115,"type":"填空","title":"115. (填空题, 1.0 points) 下面程序的输出结果是什么？ x=\"god\" y=\"\" for i in x: y+=str(ord(i)-ord('a')) print(y)______","options":[],"correctAnswer":["6143"],"selectedAnswer":["6143"],"images":[]},
  {"id":116,"type":"填空","title":"116. (填空题, 1.0 points) 下面程序的输出结果是“found it! 44”，[代码]处应补充的语句是什么？ ls=[12,33,44,55,66] for i in ls: if i==44: print(\"found it! i=44\",i) ______ else: continue","options":[],"correctAnswer":["break"],"selectedAnswer":["break"],"images":[]},
  {"id":117,"type":"填空","title":"117. (填空题, 1.0 points) 假设有一个列表a，现要求从列表a中每3个元素取1个，并且将取到的元素组成新的列表b。请设计命令。（算术运算符和赋值运算符前后不要有空格）______","options":[],"correctAnswer":["b=a[::3]"],"selectedAnswer":["b=a[::3]"],"images":[]},
  {"id":118,"type":"填空","title":"118. (填空题, 1.0 points) 给出一文本文件vote.txt，内容是校园歌手投票数据，如下所示。一行只有一个校园歌手姓名的投票才是有效票；一行有多个校园歌手姓名时，姓名之间用空格分隔，均为无效选票。下面的程序用于统计有效票数，请在[填空1][填空2]处补充合适的内容。 文本文件vote.txt内容如下。 杨雨 朱丽 陆寒 陆寒 陆寒 孙妮 杨雨 孙妮 朱丽 孙妮 杨雨…… 程序代码如下。 f = open(\"vote.txt\") names = f.readlines() f.close() n = 0 for name in ______ : num =______ if num==1: n+=1 print(\"有效票{}张\".format(n))","options":[],"correctAnswer":["names","len(name.split())"],"selectedAnswer":["names","len(name.split())"],"images":[]},
  {"id":119,"type":"填空","title":"119. (填空题, 1.0 points) 下面的程序运行时，要求通过键盘输入某班每个同学就业的行业名称，行业名称之间用空格间隔（回车结束输入）。程序的功能是统计各行业就业的学生数量，按数量从高到低排序输出。例如： 输入内容如下：交通 计算机 通信 计算机 网络 网络 交通 计算机输出内容如下：计算机：3网络：2交通：2通信：1 完善程序，请在填空处补充合适的内容。（算术运算符和赋值运算符前后不要有空格）（排序用到的lambda的参数为x,不要使用其他名) names=input(\"请输入就业行业名称，用空格间隔（回车结束输入）：\") t=names.split() d = {} for c in range(len(t)): d[t[c]]= ______ ls = list(d.items()) ls.sort(______ ) # 按照数量排序 for k in range(len(ls)): zy,num=ls[k] print(\"{}:{}\".format(zy,num))","options":[],"correctAnswer":["d.get(t[c],0)+1","key=lambda x:x[1]"],"selectedAnswer":["d.get(t[c],0)+1","key=lambda x:x[1]"],"images":[]},
  {"id":120,"type":"填空","title":"120. (填空题, 1.0 points) 下面程序的功能是：输入以逗号分隔的一组单词，判断是否有重复的单词。如果存在重复的单词，打印“有重复单词”，退出；如果无重复的单词，把单词加到words列表中，打印“没有重复单词”。[代码]处应补充的语句是什么？ txt=input(\"请输入一组单词，以逗号分隔：\") ls=txt.split(',') words=[] for word in ls: if word in words: print(\"有重复单词\") break else: ______ else: print(\"没有重复单词\")","options":[],"correctAnswer":["words.append(word)"],"selectedAnswer":["words.append(word)"],"images":[]},
  {"id":121,"type":"填空","title":"121. (填空题, 1.0 points) 写出判断整数x能否同时被3和5整除的Python 语言表达式。（算术运算符、比较运算符和赋值运算符前后不要有空格）______","options":[],"correctAnswer":["x%3==0andx%5==0"],"selectedAnswer":["x%3==0andx%5==0"],"images":[]},
  {"id":122,"type":"填空","title":"122. (填空题, 1.0 points) 以下程序的运行结果是什么？ def func(a,b): c=a**2+b b=a return c a=10 b=100 c=func(a,b)+a print(a,b,c)______","options":[],"correctAnswer":["10 100 210"],"selectedAnswer":["10 100 210"],"images":[]},
  {"id":123,"type":"填空","title":"123. (填空题, 1.0 points) 以下程序的输出结果是什么？ for i in range(1,8): if i%4==0: break else: print(i,end=\",\")______","options":[],"correctAnswer":["1,2,3"],"selectedAnswer":["1,2,3"],"images":[]},
  {"id":124,"type":"填空","title":"124. (填空题, 1.0 points) 下面程序的值是什么？在程序中运行获取结果 a,b=2,1 sum=0 for i in range(20): sum+=a/b t=a a=a+b b=t print(int(sum))______","options":[],"correctAnswer":["32"],"selectedAnswer":["32"],"images":[]},
  {"id":125,"type":"填空","title":"125. (填空题, 1.0 points) 要求通过input()函数输入元素来分别创建长度为3的列表ls1和ls2。如：ls1 = [\"name\",\"age\",\"job\"]和ls2 = [\"Peter\",23,\"student\"]。其中列表ls1的三个元素都是字符串类型，列表ls2中的第一个元素和第三个元素都是字符串类型，第二个元素是整数。然后由ls1和ls2得到如下字典： dt = {\"name\":\"Peter\",\"age\":23,\"job\":\"student}。要求： （1）输出字典的信息：{'name': 'Peter', 'age': 23, 'job': 'student'}； （2）按照如下形式输出字典中元素的信息： name--->Peter‪‪‪‪‪‪‫‪‪‪‪‪‪‫‪‪‪‪‪‪‪‪‪‪‪‫‫‪‪‪‪‪‪ age--->23‪‪‪‪‪‪‫‪‪‪‪‪‪‫‪‪‪‪‪‪‪‪‪‪‪‫‫‪‪‪‪‪‪ job--->student‪‪‪‪‪‫‪‪‪‪‪‪‫‪‪‪‪‪‪‪‪‪‪‪‫‫‪‪‪‪‪‪ （3）利用字典中的信息输出以下结果：‪‪‪‪‪‪‫‪‪‪‪‪‪‫‪‪‪‪‪‪‪‪‪‪‪‫‫‪‪‪‪‪‪ 键name对应的值是Peter，不是student 说明：以上输出仅是示例，程序的输出结果会随着输入的列表元素值不同而发生变化。 ls1 = [] ls2 = [] for i in range(3): x = input() ls1.append(x) for i in range(3): x = input() ______ ls2[1] = eval(ls2[1]) dt = dict.fromkeys(ls1) for i in range(len(ls2)): dt[ls1[i]] = ls2[i] print(dt) lskey = list(dt.keys()) for key,value in ______ : print(\"{0}--->{1}\".format(key,value)) print(\"键{0}对应的值是{1}，不是{2}\".format(lskey[0],dt[lskey[0]],dt[lskey[2]]))","options":[],"correctAnswer":["ls2.append(x)","dt.items()"],"selectedAnswer":["ls2.append(x)","dt.items()"],"images":[]},
  {"id":126,"type":"填空","title":"126. (填空题, 1.0 points) 要求通过input()函数输入元素来创建一个长度为3的列表ls1，要求列表中所有元素均为整数。将ls1中的每一个元素乘以2得到列表ls2，然后将两个列表中对应位置元素相加得到一个新的列表 new_ls，打印输出新列表new_ls。 ls1 = [] new_ls= [] for i in range(3): x = input() ls1.append(eval(x)) ls2 =______ for i in range(3): ______ print(\"新列表new_ls为：{}\".format(new_ls))","options":[],"correctAnswer":["[2*x for x in ls1]","new_ls.append(ls1[i]+ls2[i])"],"selectedAnswer":["[2*x for x in ls1]","new_ls.append(ls1[i]+ls2[i])"],"images":[]},
  {"id":127,"type":"填空","title":"127. (填空题, 1.0 points) 程序的功能是：从键盘输入一句中文文本，不含标点符号和空格、命名为变量txt，使用jieba 库对其进行分词，输出该文本中词语的平均长度，保留1位小数。 例如，从键盘输入“一半勾留在此湖”，屏幕输出“1.8”。 在横线上书写代码，完善py102.Py，代码框架如下。 #请在 处使用一行代码或表达式换 #注意:请不要修改其他已给出的代码 import ______ txt = input(\"请输入一段中文文本:\") ______ print(\"{:.1f}\".format(len(txt)/len(ls)))","options":[],"correctAnswer":["jieba","ls=jieba.lcut(txt)"],"selectedAnswer":["jieba","ls=jieba.lcut(txt)"],"images":[]},
  {"id":128,"type":"填空","title":"128. (填空题, 1.0 points) 程序的功能是：接收从键盘输入的4个数字，数字之间使用空格分隔，对应的变量名是 x0、y0、x1、y1。计算两点(x0,y0)和(x1,y1)之间的距离并输出这个距离，保留2位小数。 例如，从键盘输入“0 1 3 5”，屏幕输出“5.00”。 在横线上书写代码，完善py101.Py，代码框架如下。 #请在 处使用一行代码或表达式替换 #注意：请不要修改其他已给出的代码 ntxt = input(\"请输入4个数字(空格分隔):\") ______ x0 = eval(nls[0]) y0 = eval(nls[1]) x1 = eval(nls[2]) y1 = eval(nls[3]) r = pow(pow(x1-x0,2)+pow(y1-y0,2), ______) print(\"{:.2f}\".format(r))","options":[],"correctAnswer":["nls=ntxt.split()","0.5"],"selectedAnswer":["nls=ntxt.split()","0.5"],"images":[]},
  {"id":129,"type":"填空","title":"129. (填空题, 1.0 points) 已知一个列表中的元素都是由数字构成的字符串，如：st = [\"2\",\"4\",\"1\",\"56\"]，编程实现将列表中的元素进行数字的加法运算，并输出加法等式，即：2+4+1+56 = 63。要求不能使用循环语句。 st = [\"2\",\"4\",\"1\",\"56\"] s = ______ print(\"{0} = {1}\".format(s, ______))","options":[],"correctAnswer":["\"+\".join(st)","eval(s)"],"selectedAnswer":["\"+\".join(st)","eval(s)"],"images":[]},
  {"id":130,"type":"单选","title":"130. (判断题, 1.0 points) 浏览器或网络爬虫向服务器发送请求后，得到响应码200 表示请求成功。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":131,"type":"单选","title":"131. (判断题, 1.0 points) for循环可以用于遍历字符串、列表、元组、字典等可迭代对象。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":132,"type":"单选","title":"132. (判断题, 1.0 points) 列表的sort()方法会对列表进行排序，返回一个新的排序后的列表。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["False"],"selectedAnswer":["False"],"images":[]},
  {"id":133,"type":"单选","title":"133. (判断题, 1.0 points) 在 Python 中，//运算符表示整除，会返回商的整数部分。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":134,"type":"单选","title":"134. (判断题, 1.0 points) 在 Python 中，变量不需要先声明就可以直接使用。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":135,"type":"单选","title":"135. (判断题, 1.0 points) 集合中的元素是无序且不重复的。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":136,"type":"单选","title":"136. (判断题, 1.0 points) 字符串的split()方法可以根据指定的分隔符将字符串分割成一个列表。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":137,"type":"单选","title":"137. (判断题, 1.0 points) 字符串可以使用单引号、双引号或三引号来定义。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":138,"type":"单选","title":"138. (判断题, 1.0 points) with语句用于简化文件操作等资源管理，确保资源在使用后被正确释放。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":139,"type":"单选","title":"139. (判断题, 1.0 points) 字典的get()方法可以根据键获取对应的值，如果键不存在，会返回默认值。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":140,"type":"单选","title":"140. (判断题, 1.0 points) 子类可以重写父类的方法，以实现不同的功能。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":141,"type":"单选","title":"141. (判断题, 1.0 points) 在 Python 中，所有的对象都有一个唯一的标识符，可以使用id()函数来获取。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":142,"type":"单选","title":"142. (判断题, 1.0 points) 字典中的键必须是唯一的。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":143,"type":"单选","title":"143. (判断题, 1.0 points) 可以使用*运算符来重复字符串、列表等对象。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":144,"type":"单选","title":"144. (判断题, 1.0 points) Python 中的异常处理可以使用try-except语句来捕获和处理异常。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":145,"type":"单选","title":"145. (判断题, 1.0 points) range()函数生成的序列默认从 1 开始。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["False"],"selectedAnswer":["False"],"images":[]},
  {"id":146,"type":"单选","title":"146. (判断题, 1.0 points) 函数内部可以使用global关键字来声明全局变量，以便在函数内部修改全局变量的值。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":147,"type":"单选","title":"147. (判断题, 1.0 points) 列表和元组都可以通过索引来访问元素，且都可以修改元素的值。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["False"],"selectedAnswer":["False"],"images":[]},
  {"id":148,"type":"单选","title":"148. (判断题, 1.0 points) 可以使用in关键字来判断一个元素是否在列表、字符串、字典等对象中。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":149,"type":"单选","title":"149. (判断题, 1.0 points) 在 Python 中，if语句后面的条件表达式不需要用括号括起来。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":150,"type":"单选","title":"150. (判断题, 1.0 points) 列表的append()方法可以在列表末尾添加一个元素，extend()方法可以在列表末尾添加多个元素。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":151,"type":"单选","title":"151. (判断题, 1.0 points) Python 中的函数可以返回多个值。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":152,"type":"单选","title":"152. (判断题, 1.0 points) while循环和for循环都可以使用break语句来跳出循环。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":153,"type":"单选","title":"153. (判断题, 1.0 points) 函数可以作为参数传递给其他函数。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":154,"type":"单选","title":"154. (判断题, 1.0 points) 可以使用+运算符来连接两个字符串。( )","options":[{"label":"true","text":"True"},{"label":"false","text":"False"}],"correctAnswer":["True"],"selectedAnswer":["True"],"images":[]},
  {"id":155,"type":"填空","title":"155. (简答题, 1.0 points) 字符串合并与拆分的函数是什么，通过示例来验证","options":[],"correctAnswer":["拆分函数：split() 合并函数：join()示例验证： Python # 拆分示例 s = \"Python,Java,C++\" lst = s.split(\",\")# 结果为列表: ['Python', 'Java', 'C++'] # 合并示例 new_s = \"-\".join(lst) # 结果为字符串: 'Python-Java-C++'"],"selectedAnswer":["拆分函数：split() 合并函数：join()示例验证： Python # 拆分示例 s = \"Python,Java,C++\" lst = s.split(\",\")# 结果为列表: ['Python', 'Java', 'C++'] # 合并示例 new_s = \"-\".join(lst) # 结果为字符串: 'Python-Java-C++'"],"images":[]},
  {"id":156,"type":"填空","title":"156. (简答题, 1.0 points) 程序流程图包括哪些元素，并在word上绘出 对应的 基本元素图，截图上传","options":[],"correctAnswer":["起止框（圆角矩形）：表示程序的开始或结束。输入/输出框（平行四边形）：表示数据的输入或结果的输出。处理框（矩形）：表示计算、赋值等处理操作。判断框（菱形）：表示根据条件判断真假，决定执行路径。流程线（箭头）：表示程序执行的方向和路径。连接点（圆形）：用于流程图跨页或复杂的连接。"],"selectedAnswer":["起止框（圆角矩形）：表示程序的开始或结束。输入/输出框（平行四边形）：表示数据的输入或结果的输出。处理框（矩形）：表示计算、赋值等处理操作。判断框（菱形）：表示根据条件判断真假，决定执行路径。流程线（箭头）：表示程序执行的方向和路径。连接点（圆形）：用于流程图跨页或复杂的连接。"],"images":[]},
  {"id":157,"type":"填空","title":"157. (简答题, 1.0 points) 数据库可以分为关系型数据库和非关系型数据库，什么是关系？","options":[],"correctAnswer":["在关系型数据库中，“关系”通常指代二维表（Table）。 它具有以下特征： 行（Tuple/元组）：对应表中的一条记录。列（Attribute/属性）：对应表中的一个字段。关系模型建立在严格的数学概念（集合论）之上，表中的每一行数据之间是无序的，列也是无序的，且不允许有重复的行。"],"selectedAnswer":["在关系型数据库中，“关系”通常指代二维表（Table）。 它具有以下特征： 行（Tuple/元组）：对应表中的一条记录。列（Attribute/属性）：对应表中的一个字段。关系模型建立在严格的数学概念（集合论）之上，表中的每一行数据之间是无序的，列也是无序的，且不允许有重复的行。"],"images":[]},
  {"id":158,"type":"填空","title":"158. (简答题, 1.0 points) 简述程序的编译方式和解释方式的区别。","options":[],"correctAnswer":["编译方式：编译器将源代码一次性转换成机器语言（目标代码），生成可执行文件（如.exe）。程序执行时不再需要源代码，执行速度快。代表语言：C、C++。解释方式：解释器逐条读取源代码，边解释边执行，不生成独立的可执行文件。程序执行时需要源代码和解释器，跨平台性好但执行速度相对较慢。代表语言：Python、JavaScript。"],"selectedAnswer":["编译方式：编译器将源代码一次性转换成机器语言（目标代码），生成可执行文件（如.exe）。程序执行时不再需要源代码，执行速度快。代表语言：C、C++。解释方式：解释器逐条读取源代码，边解释边执行，不生成独立的可执行文件。程序执行时需要源代码和解释器，跨平台性好但执行速度相对较慢。代表语言：Python、JavaScript。"],"images":[]},
  {"id":159,"type":"填空","title":"159. (简答题, 1.0 points) 列表、元组、字典都用什么标记或函数创建？","options":[],"correctAnswer":["列表 (List)：使用方括号 [] 标记，或使用 list() 函数创建。 元组 (Tuple)：使用圆括号 () 标记，或使用 tuple() 函数创建。 字典 (Dictionary)：使用花括号 {} 标记（需包含键值对），或使用 dict() 函数创建。"],"selectedAnswer":["列表 (List)：使用方括号 [] 标记，或使用 list() 函数创建。 元组 (Tuple)：使用圆括号 () 标记，或使用 tuple() 函数创建。 字典 (Dictionary)：使用花括号 {} 标记（需包含键值对），或使用 dict() 函数创建。"],"images":[]},
  {"id":160,"type":"填空","title":"160. (简答题, 1.0 points) Python的内置属性__name__有什么作用？","options":[],"correctAnswer":["__name__ 是Python的一个内置属性，用于指示当前模块是如何被执行的： 作为脚本直接运行：当文件被直接运行时，__name__ 的值为 '__main__'。 被导入：当文件被作为模块导入到其他文件中时，__name__ 的值为该模块的文件名。作用：常用于编写测试代码或控制代码执行逻辑（即 if __name__ == '__main__':），确保只有在直接运行脚本时才执行某些代码，而在被导入时不执行。"],"selectedAnswer":["__name__ 是Python的一个内置属性，用于指示当前模块是如何被执行的： 作为脚本直接运行：当文件被直接运行时，__name__ 的值为 '__main__'。 被导入：当文件被作为模块导入到其他文件中时，__name__ 的值为该模块的文件名。作用：常用于编写测试代码或控制代码执行逻辑（即 if __name__ == '__main__':），确保只有在直接运行脚本时才执行某些代码，而在被导入时不执行。"],"images":[]},
  {"id":161,"type":"填空","title":"161. (简答题, 1.0 points) 面向对象语言有哪三个特性？类的成员有那些?","options":[],"correctAnswer":["三大特性：封装（Encapsulation）、继承（Inheritance）、多态（Polymorphism）。 类的成员： 属性（Attributes）：包括类属性和实例属性（变量）。 方法（Methods）：包括实例方法、类方法、静态方法（函数）。"],"selectedAnswer":["三大特性：封装（Encapsulation）、继承（Inheritance）、多态（Polymorphism）。 类的成员： 属性（Attributes）：包括类属性和实例属性（变量）。 方法（Methods）：包括实例方法、类方法、静态方法（函数）。"],"images":[]},
  {"id":162,"type":"填空","title":"162. (简答题, 1.0 points) requests库的get()方法返回Response对象，该对象的status_code、text、encoding等属性的含义是什么？","options":[],"correctAnswer":["status_code：HTTP请求的返回状态码（整数），例如 200 表示请求成功，404 表示页面未找到。 text：HTTP响应内容的字符串形式，requests 会根据猜测的编码自动解码。 encoding：从HTTP header中猜测的响应内容编码方式（如 'utf-8', 'ISO-8859-1'），用于解码 .text。"],"selectedAnswer":["status_code：HTTP请求的返回状态码（整数），例如 200 表示请求成功，404 表示页面未找到。 text：HTTP响应内容的字符串形式，requests 会根据猜测的编码自动解码。 encoding：从HTTP header中猜测的响应内容编码方式（如 'utf-8', 'ISO-8859-1'），用于解码 .text。"],"images":[]},
  {"id":163,"type":"填空","title":"163. (简答题, 1.0 points) 简述程序设计的IPO模式的特点。","options":[],"correctAnswer":["IPO模式是程序设计的基本分析方法，其特点是将程序划分为三个环节： Input（输入）：程序获得数据的来源（如文件、键盘输入、网络）。Process（处理）：程序对数据进行计算、逻辑判断和转换的核心步骤（算法）。Output（输出）：程序展示运算结果的方式（如屏幕打印、写入文件、数据库存储）。"],"selectedAnswer":["IPO模式是程序设计的基本分析方法，其特点是将程序划分为三个环节： Input（输入）：程序获得数据的来源（如文件、键盘输入、网络）。Process（处理）：程序对数据进行计算、逻辑判断和转换的核心步骤（算法）。Output（输出）：程序展示运算结果的方式（如屏幕打印、写入文件、数据库存储）。"],"images":[]}
];

const WEB_EXAM_BANK_QUESTIONS = [
  {"id":1,"type":"单选","title":"1. (单选题, 15.0 分) 在HTML文档中，下面代码的作用是( )。<a href=\"poem.htm#李白\">李白诗词</a>","options":[{"label":"A","text":"在poem.htm页面创建锚点“李白”"},{"label":"B","text":"在poem.htm页面创建锚点“李白诗词”"},{"label":"C","text":"跳转到poem.htm页面的锚点“李白”处"},{"label":"D","text":"跳转到poem.htm页面的锚点“李白诗词”处"}],"correctAnswer":["跳转到poem.htm页面的锚点“李白”处"],"selectedAnswer":["跳转到poem.htm页面的锚点“李白”处"],"images":[]},
  {"id":2,"type":"单选","title":"2. (单选题, 15.0 分) 以下哪个属于JavaScript单行注释的正确写法?( )。","options":[{"label":"A","text":"<!--被注释掉的内容-->"},{"label":"B","text":"#被注释掉的内容"},{"label":"C","text":"//被注释掉的内容"},{"label":"D","text":"“被注释掉的内容”"}],"correctAnswer":["//被注释掉的内容"],"selectedAnswer":["//被注释掉的内容"],"images":[]},
  {"id":3,"type":"填空","title":"1. (填空题, 5.0 分) 与标记<b></b>功能相同的标记是______。","options":[],"correctAnswer":["<strong></strong>"],"selectedAnswer":["<strong></strong>"],"images":[]},
  {"id":4,"type":"填空","title":"2. (填空题, 5.0 分) 去掉 a 标签默认下划线，用 text-decoration: ____。","options":[],"correctAnswer":["none"],"selectedAnswer":["none"],"images":[]},
  {"id":5,"type":"单选","title":"1. (判断题, 5.0 分) z-index 值越大，元素越靠近用户。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":["对"],"selectedAnswer":["对"],"images":[]},
  {"id":6,"type":"单选","title":"2. (判断题, 5.0 分) 记号mark 标记用来定义带有记号的文本。在需要突出显示文本时可以使用mark 标记。此标记对关键字做高亮处理(蓝底色标注)，突出显示，标注重点，在搜索方面可以应用。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":["错"],"selectedAnswer":["错"],"images":[]},
  {"id":7,"type":"填空","title":"1. (简答题, 15.0 分) 简述HTML中三种列表类型的特点及适用场景。","options":[],"correctAnswer":["<p>1. 基于输入类型（type 属性）验证</p><p>通过指定输入框的type，浏览器会自动验证输入内容是否匹配该类型的格式。示例：验证邮箱格式</p><p>html</p><p>预览</p><p>&lt;input type=&quot;email&quot; name=&quot;user-email&quot; required&gt;</p><p>说明：当输入内容不符合邮箱格式（如缺少@）时，提交表单会触发浏览器的原生提示。</p><p>2. 基于属性限制验证</p><p>通过表单元素的特定属性（如required、min、max、pattern等）设置验证规则。示例：验证必填项 + 密码长度不小于 6 位</p><p>html</p><p>预览</p><p>&lt;input type=&quot;password&quot; name=&quot;user-pwd&quot; required minlength=&quot;6&quot;&gt;</p><p>说明：required强制输入框不能为空，minlength限制输入字符数不少于 6 位。</p><p>3. 基于正则表达式（pattern 属性）验证</p><p>通过pattern属性指定正则表达式，匹配输入内容的格式。示例：验证手机号（以 1 开头的 11 位数字）</p><p>html</p><p>预览</p><p>&lt;input type=&quot;tel&quot; name=&quot;user-phone&quot; pattern=&quot;^1[3-9]\\d{9}$&quot; title=&quot;请输入有效的手机号&quot;&gt;</p><p><br/></p>"],"selectedAnswer":["<p>1. 基于输入类型（type 属性）验证</p><p>通过指定输入框的type，浏览器会自动验证输入内容是否匹配该类型的格式。示例：验证邮箱格式</p><p>html</p><p>预览</p><p>&lt;input type=&quot;email&quot; name=&quot;user-email&quot; required&gt;</p><p>说明：当输入内容不符合邮箱格式（如缺少@）时，提交表单会触发浏览器的原生提示。</p><p>2. 基于属性限制验证</p><p>通过表单元素的特定属性（如required、min、max、pattern等）设置验证规则。示例：验证必填项 + 密码长度不小于 6 位</p><p>html</p><p>预览</p><p>&lt;input type=&quot;password&quot; name=&quot;user-pwd&quot; required minlength=&quot;6&quot;&gt;</p><p>说明：required强制输入框不能为空，minlength限制输入字符数不少于 6 位。</p><p>3. 基于正则表达式（pattern 属性）验证</p><p>通过pattern属性指定正则表达式，匹配输入内容的格式。示例：验证手机号（以 1 开头的 11 位数字）</p><p>html</p><p>预览</p><p>&lt;input type=&quot;tel&quot; name=&quot;user-phone&quot; pattern=&quot;^1[3-9]\\d{9}$&quot; title=&quot;请输入有效的手机号&quot;&gt;</p><p><br/></p>"],"images":[]},
  {"id":8,"type":"填空","title":"1. (编程题, 35.0 分) 测试题：请自定义函数实现两数相加，返回相加结果，用户通过prompt()输入两个数值，程序计算相加结果，输出到页面上，输出结果如下图所示。要求将代码粘贴到作答区，同时附上实现效果截图。","options":[],"correctAnswer":["<p></p><p><br/></p><p><br/></p><p><title>两数相加</title></p><p><br/></p><p><br/></p><p><br/></p><p>&lt; script&gt;&lt; /script&gt;</p><p><br/></p><p>// 自定义相加函数</p><p>function add(a, b) {</p><p>return a + b;</p><p>}</p><p><br/></p><p>// 获取用户输入</p><p>let num1 = parseFloat(prompt(&quot;请输入第一个数：&quot;));</p><p>let num2 = parseFloat(prompt(&quot;请输入第二个数：&quot;));</p><p><br/></p><p>// 计算并输出结果</p><p>let result = add(num1, num2);</p><p>document.write(`${num1}+${num2}=${result}`);</p><p><br/></p><p><br/></p><p><br/></p>"],"selectedAnswer":["<p></p><p><br/></p><p><br/></p><p><title>两数相加</title></p><p><br/></p><p><br/></p><p><br/></p><p>&lt; script&gt;&lt; /script&gt;</p><p><br/></p><p>// 自定义相加函数</p><p>function add(a, b) {</p><p>return a + b;</p><p>}</p><p><br/></p><p>// 获取用户输入</p><p>let num1 = parseFloat(prompt(&quot;请输入第一个数：&quot;));</p><p>let num2 = parseFloat(prompt(&quot;请输入第二个数：&quot;));</p><p><br/></p><p>// 计算并输出结果</p><p>let result = add(num1, num2);</p><p>document.write(`${num1}+${num2}=${result}`);</p><p><br/></p><p><br/></p><p><br/></p>"],"images":["https://p.ananas.chaoxing.com/star3/origin/1943b5c413c8f69f8b8970498f17e882.png"]}
];

const WEB_WORK_BANK_QUESTIONS = [
  {"id":1,"type":"单选","title":"1. (单选题) 以下哪个不是Web的特点?( )","options":[{"label":"A","text":"具有平台无关性"},{"label":"B","text":"不支持分布式结构"},{"label":"C","text":"易导航和图形化"},{"label":"D","text":"具有交互性"}],"correctAnswer":["不支持分布式结构"],"selectedAnswer":["不支持分布式结构"],"images":[]},
  {"id":2,"type":"单选","title":"2. (单选题) 关于CSS一词，以下哪个全称是正确的?( )。","options":[{"label":"A","text":"Cascading Style Structure"},{"label":"B","text":"Cascading Style Sheets"},{"label":"C","text":"Cascading Special Structure"},{"label":"D","text":"Cascading Special Sheets"}],"correctAnswer":["Cascading Style Sheets"],"selectedAnswer":["Cascading Style Sheets"],"images":[]},
  {"id":3,"type":"单选","title":"3. (单选题) HTML是一种( )语言。","options":[{"label":"A","text":"编译型"},{"label":"B","text":"超文本标记"},{"label":"C","text":"高级程序设计"},{"label":"D","text":"面向对象的编程"}],"correctAnswer":["超文本标记"],"selectedAnswer":["超文本标记"],"images":[]},
  {"id":4,"type":"单选","title":"4. (单选题) 下列不是开发HTML网页的软件是( )。","options":[{"label":"A","text":"VS Code"},{"label":"B","text":"WebStorm"},{"label":"C","text":"HBuilder"},{"label":"D","text":"Visual BASIC"}],"correctAnswer":["Visual BASIC"],"selectedAnswer":["Visual BASIC"],"images":[]},
  {"id":5,"type":"单选","title":"5. (单选题) Web标准的制定者是( )。","options":[{"label":"A","text":"欧洲计算机制造商协会(ECMA)"},{"label":"B","text":"微软公司(Microsoft)"},{"label":"C","text":"网景公司(Netscape)"},{"label":"D","text":"万维网联盟(W3C)"}],"correctAnswer":["万维网联盟(W3C)"],"selectedAnswer":["万维网联盟(W3C)"],"images":[]},
  {"id":6,"type":"单选","title":"6. (单选题) HTML中规范的注释声明是（ ）。","options":[{"label":"A","text":"//这是注释"},{"label":"B","text":"！！这是注释"},{"label":"C","text":"/*这是注释*/"},{"label":"D","text":"<!--这是注释-->"}],"correctAnswer":["<!--这是注释-->"],"selectedAnswer":["<!--这是注释-->"],"images":[]},
  {"id":7,"type":"单选","title":"7. (单选题) 关于HTML文件类型，以下哪种说法是正确的？（ ）","options":[{"label":"A","text":"HTML文件后缀名既可以是.html也可以是.htm结尾。"},{"label":"B","text":"HTML文件后缀名只能是.html结尾。"},{"label":"C","text":"HTML文件可以没有后缀名。"},{"label":"D","text":"HTML文件后缀名是.txt。"}],"correctAnswer":["HTML文件后缀名既可以是.html也可以是.htm结尾。"],"selectedAnswer":["HTML文件后缀名既可以是.html也可以是.htm结尾。"],"images":[]},
  {"id":8,"type":"单选","title":"8. (单选题) 关于换行标签<br>以下描述不正确的是?( )","options":[{"label":"A","text":"<br>相当于一次回车键所产生的换行效果。"},{"label":"B","text":"每出现一次<br>标签只能换一行。"},{"label":"C","text":"可以直接连续按多次回车键代替多个<br>标签。"},{"label":"D","text":"可以使用多个<br>标签显示多行连续换行效果。"}],"correctAnswer":["可以直接连续按多次回车键代替多个标签。"],"selectedAnswer":["可以直接连续按多次回车键代替多个标签。"],"images":[]},
  {"id":9,"type":"单选","title":"9. (单选题) 以下哪个标签可以实现加粗字体的效果?( )","options":[{"label":"A","text":"<br>"},{"label":"B","text":"<i>"},{"label":"C","text":"<sub>"},{"label":"D","text":"<strong>"}],"correctAnswer":["<strong>"],"selectedAnswer":["<strong>"],"images":[]},
  {"id":10,"type":"单选","title":"10. (单选题) 以下哪个标签可以把文本显示为上标效果?( )","options":[{"label":"A","text":"<sub>"},{"label":"B","text":"<sup>"},{"label":"C","text":"<del>"},{"label":"D","text":"<ins>"}],"correctAnswer":["<sup>"],"selectedAnswer":["<sup>"],"images":[]},
  {"id":11,"type":"单选","title":"11. (单选题) 以下哪个标签可以为文本添加删除线?( )","options":[{"label":"A","text":"<sub>"},{"label":"B","text":"<sup>"},{"label":"C","text":"<del>"},{"label":"D","text":"<ins>"}],"correctAnswer":["<del>"],"selectedAnswer":["<del>"],"images":[]},
  {"id":12,"type":"单选","title":"12. (单选题) 使用何种标签可以使得其内部的多次回车换行或多次空格可以正常显示?( )","options":[{"label":"A","text":"<p>"},{"label":"B","text":"<div>"},{"label":"C","text":"<pre>"},{"label":"D","text":"<a>"}],"correctAnswer":["<pre>"],"selectedAnswer":["<pre>"],"images":[]},
  {"id":13,"type":"单选","title":"13. (单选题) 关于标题字标记对齐方式，标记属性取值不正确的是( )。","options":[{"label":"A","text":"居中对齐:<h1align=\"middle\">…</h1>"},{"label":"B","text":"居右对齐:<h2 align=\"right\">…</h2>"},{"label":"C","text":"居左对齐:<h4 align=\"left\">…</h4>"},{"label":"D","text":"两端对齐:<h6 align=\"justify\">…</h6>"}],"correctAnswer":["居中对齐:…"],"selectedAnswer":["居中对齐:…"],"images":[]},
  {"id":14,"type":"单选","title":"14. (单选题) 下列标记中是单标记的是( )。","options":[{"label":"A","text":"body标记"},{"label":"B","text":"br标记"},{"label":"C","text":"html标记"},{"label":"D","text":"title标记"}],"correctAnswer":["br标记"],"selectedAnswer":["br标记"],"images":[]},
  {"id":15,"type":"单选","title":"15. (单选题) 下列标记中表示版权符号的是( ) 。","options":[{"label":"A","text":"©"},{"label":"B","text":"®"},{"label":"C","text":"&"},{"label":"D","text":"\""}],"correctAnswer":["©"],"selectedAnswer":["©"],"images":[]},
  {"id":16,"type":"单选","title":"16. (单选题) 在HTML中，下列代码（ ）可以实现每隔60s自动刷新页面的功能。","options":[{"label":"A","text":"<meta http-equiv =\"refresh\" content = \"1\">"},{"label":"B","text":"<meta http-equiv =\"refresh\" content = \"60\">"},{"label":"C","text":"<meta http-equiv =\"expires\" content = \"1\">"},{"label":"D","text":"<meta http-equiv =\"expires\" content = \"60\">"}],"correctAnswer":["<meta http-equiv =\"refresh\" content = \"60\">"],"selectedAnswer":["<meta http-equiv =\"refresh\" content = \"60\">"],"images":[]},
  {"id":17,"type":"单选","title":"17. (单选题) 在HTML文件中，ul标记之间必须使用li标记作用是( )。","options":[{"label":"A","text":"添加列表项值"},{"label":"B","text":"创建有序列表"},{"label":"C","text":"创建无序列表"},{"label":"D","text":"创建自定义列表"}],"correctAnswer":["添加列表项值"],"selectedAnswer":["添加列表项值"],"images":[]},
  {"id":18,"type":"单选","title":"18. (单选题) 以下哪个标签用于定义列表项?","options":[{"label":"A","text":"<item>"},{"label":"B","text":"<li>"},{"label":"C","text":"<list>"},{"label":"D","text":"<ld>"}],"correctAnswer":["<li>"],"selectedAnswer":["<li>"],"images":[]},
  {"id":19,"type":"单选","title":"19. (单选题) 以下哪个属性可以改变有序列表的编号类型?","options":[{"label":"A","text":"type"},{"label":"B","text":"style"},{"label":"C","text":"start"},{"label":"D","text":"value"}],"correctAnswer":["type"],"selectedAnswer":["type"],"images":[]},
  {"id":20,"type":"单选","title":"20. (单选题) 以下哪个CSS属性可以去掉列表项前的符号?","options":[{"label":"A","text":"list-style-type: none;"},{"label":"B","text":"list-style-image: none;"},{"label":"C","text":"list-style-position: none;"},{"label":"D","text":"list-style: remove;"}],"correctAnswer":["list-style-type: none;"],"selectedAnswer":["list-style-type: none;"],"images":[]},
  {"id":21,"type":"单选","title":"21. (单选题) 以下哪个属性可以设置有序列表的起始编号?","options":[{"label":"A","text":"start"},{"label":"B","text":"value"},{"label":"C","text":"type"},{"label":"D","text":"begin"}],"correctAnswer":["start"],"selectedAnswer":["start"],"images":[]},
  {"id":22,"type":"单选","title":"22. (单选题) 超链接的地址通过哪个属性指定?","options":[{"label":"A","text":"src"},{"label":"B","text":"href"},{"label":"C","text":"url"},{"label":"D","text":"link"}],"correctAnswer":["href"],"selectedAnswer":["href"],"images":[]},
  {"id":23,"type":"单选","title":"23. (单选题) 以下哪个属性可以让超链接在新窗口打开?","options":[{"label":"A","text":"target=\"_self\""},{"label":"B","text":"target=\"_blank\""},{"label":"C","text":"target=\"_top\""},{"label":"D","text":"target=\"_parent\""}],"correctAnswer":["target=\"_blank\""],"selectedAnswer":["target=\"_blank\""],"images":[]},
  {"id":24,"type":"单选","title":"24. (单选题) 以下哪个是锚点链接的正确写法?","options":[{"label":"A","text":"<a href=\"#section1\">跳转到 section1</a>"},{"label":"B","text":"<a name=\"section1\">跳转到 section1</a>"},{"label":"C","text":"<a link=\"#section1\">跳转到 section1</a>"},{"label":"D","text":"<a id=\"section1\">跳转到 section1</a>"}],"correctAnswer":["跳转到 section1"],"selectedAnswer":["跳转到 section1"],"images":[]},
  {"id":25,"type":"单选","title":"25. (单选题) 以下哪个伪类用于设置链接被点击瞬间的样式?","options":[{"label":"A","text":":hover"},{"label":"B","text":":visited"},{"label":"C","text":":active"},{"label":"D","text":":focus"}],"correctAnswer":[":active"],"selectedAnswer":[":active"],"images":[]},
  {"id":26,"type":"单选","title":"26. (单选题) 在HTML文档中，下面代码的作用是( )。<a href=\"poem.htm#李白\">李白诗词</a>","options":[{"label":"A","text":"在poem.htm页面创建锚点“李白”"},{"label":"B","text":"在poem.htm页面创建锚点“李白诗词”"},{"label":"C","text":"跳转到poem.htm页面的锚点“李白”处"},{"label":"D","text":"跳转到poem.htm页面的锚点“李白诗词”处"}],"correctAnswer":["跳转到poem.htm页面的锚点“李白”处"],"selectedAnswer":["跳转到poem.htm页面的锚点“李白”处"],"images":[]},
  {"id":27,"type":"单选","title":"27. (单选题) <img> 标签中必须用于指定图片路径的属性是","options":[{"label":"A","text":"href"},{"label":"B","text":"src"},{"label":"C","text":"url"},{"label":"D","text":"link"}],"correctAnswer":["src"],"selectedAnswer":["src"],"images":[]},
  {"id":28,"type":"单选","title":"28. (单选题) 当图片无法显示时，供用户查看的替代文字由哪个属性给出?","options":[{"label":"A","text":"title"},{"label":"B","text":"text"},{"label":"C","text":"alt"},{"label":"D","text":"name"}],"correctAnswer":["alt"],"selectedAnswer":["alt"],"images":[]},
  {"id":29,"type":"单选","title":"29. (单选题) 若想使图片宽度 200 px 且保持原比例，应只设置","options":[{"label":"A","text":"仅 width=\"200\""},{"label":"B","text":"仅 height=\"200\""},{"label":"C","text":"同时设 width 与 height"},{"label":"D","text":"设 zoom=\"200\""}],"correctAnswer":["仅 width=\"200\""],"selectedAnswer":["仅 width=\"200\""],"images":[]},
  {"id":30,"type":"单选","title":"30. (单选题) 给图片加“鼠标悬停提示”应使用","options":[{"label":"A","text":"alt"},{"label":"B","text":"title"},{"label":"C","text":"tooltip"},{"label":"D","text":"prompt"}],"correctAnswer":["prompt"],"selectedAnswer":["prompt"],"images":[]},
  {"id":31,"type":"单选","title":"31. (单选题) 运行如下代码，将会在浏览器里看到( )。<table width = \"30%\" border = \"1\"><tr><td colspan = \"3\"> </td></tr><tr><td rowspan = \"2\"> </td> <td> </td> <td> </td> </tr><tr><td> </td> <td> </td></tr></table>","options":[{"label":"A","text":"3个单元格"},{"label":"B","text":"4个单元格"},{"label":"C","text":"5个单元格"},{"label":"D","text":"6个单元格"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":32,"type":"单选","title":"32. (单选题) 默认状态下 <th> 文字的对齐方式是","options":[{"label":"A","text":"加粗 + 水平居中"},{"label":"B","text":"斜体 + 右对齐"},{"label":"C","text":"正常 + 左对齐"},{"label":"D","text":"下划线"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":33,"type":"单选","title":"33. (单选题) 合并同一行中的多个单元格应使用属性","options":[{"label":"A","text":"rowspan"},{"label":"B","text":"colspan"},{"label":"C","text":"merge"},{"label":"D","text":"span"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":34,"type":"单选","title":"34. (单选题) 下列标签中，能把表格结构划分为“头部、主体、尾部”的是","options":[{"label":"A","text":"<caption>"},{"label":"B","text":"<header> <main> <footer>"},{"label":"C","text":"<colgroup>"},{"label":"D","text":"<thead> <tbody> <tfoot>"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":35,"type":"单选","title":"35. (单选题) 让表格标题 <caption> 显示在底部，需设置","options":[{"label":"A","text":"caption-align:bottom"},{"label":"B","text":"caption-side:bottom"},{"label":"C","text":"align:bottom"},{"label":"D","text":"caption-place:bottom"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":36,"type":"单选","title":"36. (单选题) 以下哪些属于表格标签系列?( )","options":[{"label":"A","text":"<table>,<hr>和<td>"},{"label":"B","text":"<table>,<tr>和<div>"},{"label":"C","text":"<table>,<tr>和<td>"},{"label":"D","text":"<table>,<br>和<th>"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":37,"type":"单选","title":"37. (单选题) 关于表格标题标签<caption>，以下哪种说法是错误的?( )","options":[{"label":"A","text":"使用该标签添加的标题默认会出现在表格顶部。"},{"label":"B","text":"使用该标签添加的标题默认会出现在表格底部。"},{"label":"C","text":"使用该标签添加的标题默认会居中显示。"},{"label":"D","text":"不使用该标签也可以生成一个无标题的表格，不会报错。"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":38,"type":"单选","title":"38. (单选题) HTML中( )标签用于在网页中创建表单。","options":[{"label":"A","text":"<input>"},{"label":"B","text":"<select>"},{"label":"C","text":"<table>"},{"label":"D","text":"<form>"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":39,"type":"单选","title":"39. (单选题) HTML中( )属性用于设置表单要提交的地址。","options":[{"label":"A","text":"name"},{"label":"B","text":"method"},{"label":"C","text":"action"},{"label":"D","text":"Id"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":40,"type":"单选","title":"40. (单选题) 阅读代码，选择正确答案( )。<input type = \"text\"……<input type = \"radio\"……<input type = \"checkbox\"……<input type = \"file\"……","options":[{"label":"A","text":"分别表示:文本框，单选按钮，复选框，文件域"},{"label":"B","text":"分别表示:单选按钮，文本框，复选框，文件域"},{"label":"C","text":"分别表示:复选框，文本框，单选按钮，文件域"},{"label":"D","text":"分别表示:文件域，文本框，单选按钮，复选框"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":41,"type":"单选","title":"41. (单选题) 让表单提交的数据使用 POST 方式，应在 form 标签内写()。","options":[{"label":"A","text":"method=\"POST\""},{"label":"B","text":"type=\"POST\""},{"label":"C","text":"action=\"POST\""},{"label":"D","text":"way=\"POST\""}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":42,"type":"单选","title":"42. (单选题) 下拉列表的多选属性是()。","options":[{"label":"A","text":"multiple"},{"label":"B","text":"multiselect"},{"label":"C","text":"many"},{"label":"D","text":"checkbox"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":43,"type":"单选","title":"43. (单选题) 限制输入框只能输入 0-100 之间的数字，最佳原生方案是()。","options":[{"label":"A","text":"type=\"number\" min=\"0\" max=\"100\""},{"label":"B","text":"type=\"range\""},{"label":"C","text":"type= text pattern= [0-9]"},{"label":"D","text":"type=\"digit\""}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":44,"type":"单选","title":"44. (单选题) 为 input 输入框添加提示文本，应使用属性()。","options":[{"label":"A","text":"placeholder"},{"label":"B","text":"hint"},{"label":"C","text":"title"},{"label":"D","text":"prompt"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":45,"type":"单选","title":"45. (单选题) 为 input 添加必填提示，应使用的属性是","options":[{"label":"A","text":"must"},{"label":"B","text":"required"},{"label":"C","text":"validate"},{"label":"D","text":"not-empty"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":46,"type":"单选","title":"46. (单选题) HTML5 中用于输入网址且自带协议检测的新类型是","options":[{"label":"A","text":"type=\"url\""},{"label":"B","text":"type=\"http\""},{"label":"C","text":"type=\"link\""},{"label":"D","text":"type=\"web\""}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":47,"type":"单选","title":"47. (单选题) CSS样式表根据代码放置的位置共有3种形式，那么代码片段<p style=\"color:red\">测试</p>的声明方式属于哪一种?( )","options":[{"label":"A","text":"外部样式表"},{"label":"B","text":"内部样式表"},{"label":"C","text":"内联样式表"},{"label":"D","text":"以上都不正确"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":48,"type":"单选","title":"48. (单选题) 已知外部css文件中有:p{color:red}，<style>与</style>中有:p{color:green} , 而<body>与</body>中有:<p style=\"color:yellow\">测试</p>，请问此时段落元素<p>的字体颜色是?( )","options":[{"label":"A","text":"黄色"},{"label":"B","text":"绿色"},{"label":"C","text":"红色"},{"label":"D","text":"黑色"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":49,"type":"单选","title":"49. (单选题) 关于样式表以下说明不正确的是?( )","options":[{"label":"A","text":"样式表可以用来设置元素的字体、颜色等样式内容。"},{"label":"B","text":"行内样式表使用的是style属性。"},{"label":"C","text":"如果样式表中设置的内容和浏览器的默认设置不同，则最终显示结果为样式表中的内容。"},{"label":"D","text":"每个外部样式表都只能链接到一个网页文档。"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":50,"type":"单选","title":"50. (单选题) 关于外部样式表的说法错误的是?( )","options":[{"label":"A","text":"文件扩展名为.css"},{"label":"B","text":"外部样式表中的内容以<style>开始，</style>结束。"},{"label":"C","text":"使用外部样式表可以使多个网页统一样式风格。"},{"label":"D","text":"同一个网页文档允许引用多个外部样式表。"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":51,"type":"单选","title":"51. (单选题) 引用外部样式表时，link 标签应放在 HTML 的哪一部分?","options":[{"label":"A","text":"<title> 之前"},{"label":"B","text":"<head> 内"},{"label":"C","text":"<body> 底部"},{"label":"D","text":"任意位置"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":52,"type":"单选","title":"52. (单选题) 若同一元素被行内、内部、外部三种样式同时定义，浏览器默认按哪层叠顺序渲染?","options":[{"label":"A","text":"外部→内部→行内"},{"label":"B","text":"行内→内部→外部"},{"label":"C","text":"内部→外部→行内"},{"label":"D","text":"随机"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":53,"type":"单选","title":"53. (单选题) 在 <style> 标签内注释 CSS 代码，应使用","options":[{"label":"A","text":"// 注释"},{"label":"B","text":"/* 注释 */"},{"label":"C","text":"<!-- 注释 -->"},{"label":"D","text":"# 注释"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":54,"type":"单选","title":"54. (单选题) 若要向网页中导入同一目录下的样式表“main.css”，正确的代码是( )。","options":[{"label":"A","text":"<link src=\"main.css\" rel=\"stylesheet\" type=\"text/css\">"},{"label":"B","text":"<link href=\"main.css\" rel=\"stylesheet\" type=\"text/css\">"},{"label":"C","text":"<link href=\"main.css\" type=\"text/css\">"},{"label":"D","text":"<include rel=\"stylesheet\" type=\"text/css\" src=\"main.css\">"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":55,"type":"单选","title":"55. (单选题) 如何给页面上所有的段落元素<p>添加字体颜色为绿色?( )","options":[{"label":"A","text":".p{color:green}"},{"label":"B","text":"p.all{color:green}"},{"label":"C","text":"#p{color:green}"},{"label":"D","text":"p{color:green}"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":56,"type":"单选","title":"56. (单选题) 在CSS中为某个<div>标签设置样式div{width:100px; height: 100px; padding:0 15px; border:7px}请问在W3C标准模型的状态下该<div>元素的实际宽度是?( )","options":[{"label":"A","text":"100px"},{"label":"B","text":"114px"},{"label":"C","text":"130px"},{"label":"D","text":"144px"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":57,"type":"单选","title":"57. (单选题) 希望为段落元素<p>设置:文本居中对齐、首行缩进2个字符、字符间距为10像素，以下哪种写法是正确的?( )","options":[{"label":"A","text":"p{text-indent: center; text-align: 2em; letter-spacing: 10px;}"},{"label":"B","text":"p{letter-spacing: center; text-indent: 2em; text-align: 10px;}"},{"label":"C","text":"p{text-align: center; letter-spacing: 2em; text-indent: 10px;}"},{"label":"D","text":"p{text-align: center; text-indent: 2em; letter-spacing: 10px;}"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":58,"type":"单选","title":"58. (单选题) 以下哪种做法可以让背景图像balloon.jpg不平铺并且固定在屏幕上不要随着滚动条下拉而滚动?( )","options":[{"label":"A","text":"body{background: url(balloon.jpg) no-repeat; background-attachment: scroll;}"},{"label":"B","text":"body{background: url(balloon.jpg); background-attachment: scroll;}"},{"label":"C","text":"body{background: url(balloon.jpg) no-repeat; background-attachment: fixed;}"},{"label":"D","text":"body{background: url(balloon.jpg); background-attachment: fixed;}"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":59,"type":"单选","title":"59. (单选题) 想要设置1像素宽的实线红色边框效果，以下哪句是正确的?( )","options":[{"label":"A","text":"border: 1px dashed red;"},{"label":"B","text":"border: 1px solid #FF0;"},{"label":"C","text":"border: 1px dashed rgb(255,0,0);"},{"label":"D","text":"border: 1px solid #ff0000;"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":60,"type":"单选","title":"60. (单选题) 关于字体的样式风格，以下哪种说法是不正确的?( )","options":[{"label":"A","text":"font-variant: small-caps;用于设置字体中英文字母均为小写字母。"},{"label":"B","text":"font-family: \"宋体\";用于设置字体的系列为宋体字。"},{"label":"C","text":"font-size:16px;用于设置字体尺寸大小为16像素。"},{"label":"D","text":"font-weight: bold;用于设置字体加粗。"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":61,"type":"单选","title":"61. (单选题) 希望实现上下边框均为虚线、左右边框均为实线效果，以下哪种写法不正确?( )","options":[{"label":"A","text":"border-style: dashed solid;"},{"label":"B","text":"border-style: dashed solid dashed solid;"},{"label":"C","text":"border-style: dashed solid dashed;"},{"label":"D","text":"border-style: dashed solid solid;"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":62,"type":"单选","title":"62. (单选题) 去掉列表项前默认圆点，应写()。","options":[{"label":"A","text":"list-style: none"},{"label":"B","text":"list-type: 0 C"},{"label":"C","text":"marker: hide"},{"label":"D","text":"ul-style: none"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":63,"type":"单选","title":"63. (单选题) 关于超链接<a>的样式描述，以下哪种是不正确的?( )","options":[{"label":"A","text":"a:visited表示已经访问过的超链接。"},{"label":"B","text":"a:hover表示鼠标悬浮在上面的超链接。"},{"label":"C","text":"a:active表示正在被点击的超链接。"},{"label":"D","text":"a:link表示鼠标悬浮的超链接"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":64,"type":"单选","title":"64. (单选题) 通配符选择器的符号是()。","options":[{"label":"A","text":"#"},{"label":"B","text":"."},{"label":"C","text":"*"},{"label":"D","text":"@"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":65,"type":"单选","title":"65. (单选题) 选择 class=\"box\" 的元素，语法是()。","options":[{"label":"A","text":"box{}"},{"label":"B","text":".box{}"},{"label":"C","text":"#box{}"},{"label":"D","text":"*box{}"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":66,"type":"单选","title":"66. (单选题) 后代选择器用于选中某元素内部的所有指定后代，其符号是()。","options":[{"label":"A","text":">"},{"label":"B","text":"(空格)"},{"label":"C","text":"+"},{"label":"D","text":"~"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":67,"type":"单选","title":"67. (单选题) 子选择器(仅选中直接子元素)的符号是()。","options":[{"label":"A","text":">"},{"label":"B","text":"(空格)"},{"label":"C","text":"+"},{"label":"D","text":"~"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":68,"type":"单选","title":"68. (单选题) 以下哪个属性不能用于设置元素的单边内边距?( )","options":[{"label":"A","text":"padding-upper"},{"label":"B","text":"padding-left"},{"label":"C","text":"padding-right"},{"label":"D","text":"padding-bottom"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":69,"type":"单选","title":"69. (单选题) 下列( )属性能够设置框模型的内边距为10、20、30、40(顺时针方向)。","options":[{"label":"A","text":"padding:10px"},{"label":"B","text":"padding:10px 20px 30px"},{"label":"C","text":"padding:10px 20px 30px 40px"},{"label":"D","text":"padding:10px 40px"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":70,"type":"单选","title":"70. (单选题) CSS 盒模型中，默认情况下元素可见框的总宽度等于","options":[{"label":"A","text":"width"},{"label":"B","text":"width+padding"},{"label":"C","text":"width+padding+border"},{"label":"D","text":"width+padding+border+margin"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":71,"type":"单选","title":"71. (单选题) 给元素设置 margin:10px 20px; 表示","options":[{"label":"A","text":"上下 10，左右 20"},{"label":"B","text":"上下 20，左右 10"},{"label":"C","text":"四边均 15"},{"label":"D","text":"仅左右生效"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":72,"type":"单选","title":"72. (单选题) 设置元素左浮动应使用","options":[{"label":"A","text":"float: left"},{"label":"B","text":"float: right"},{"label":"C","text":"float: center"},{"label":"D","text":"align: left"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":73,"type":"单选","title":"73. (单选题) 浮动元素会脱离下列哪种流?","options":[{"label":"A","text":"文本流"},{"label":"B","text":"正常文档流"},{"label":"C","text":"定位流"},{"label":"D","text":"弹性流"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":74,"type":"单选","title":"74. (单选题) 浮动元素默认宽度为","options":[{"label":"A","text":"100%"},{"label":"B","text":"0"},{"label":"C","text":"内容宽度"},{"label":"D","text":"父元素宽度"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":75,"type":"单选","title":"75. (单选题) 默认值 position: ______ 表示元素保持在普通文档流中。","options":[{"label":"A","text":"static"},{"label":"B","text":"relative"},{"label":"C","text":"absolute"},{"label":"D","text":"fixed"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":76,"type":"单选","title":"76. (单选题) 绝对定位 position: absolute 的偏移基准是","options":[{"label":"A","text":"视口"},{"label":"B","text":"父元素 content 区域"},{"label":"C","text":"最近的已定位祖先元素"},{"label":"D","text":"页面顶部"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":77,"type":"单选","title":"77. (单选题) 固定定位 position: fixed 的偏移基准是","options":[{"label":"A","text":"视口"},{"label":"B","text":"父元素"},{"label":"C","text":"根元素"},{"label":"D","text":"自身原位置"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":78,"type":"单选","title":"78. (单选题) 提高定位元素层叠顺序，应设置","options":[{"label":"A","text":"index"},{"label":"B","text":"z-index"},{"label":"C","text":"layer"},{"label":"D","text":"stack"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":79,"type":"单选","title":"79. (单选题) 以下哪个属于JavaScript单行注释的正确写法?( )。","options":[{"label":"A","text":"<!--被注释掉的内容-->"},{"label":"B","text":"#被注释掉的内容"},{"label":"C","text":"//被注释掉的内容"},{"label":"D","text":"“被注释掉的内容”"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":80,"type":"单选","title":"80. (单选题) 已知有var msg = \"Hello JavaScript\";且var k = msg.charAt(1);请问k的取值是多少?( )。","options":[{"label":"A","text":"H"},{"label":"B","text":"e"},{"label":"C","text":"t"},{"label":"D","text":"J"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":81,"type":"单选","title":"81. (单选题) 在JavaScript中，已知有for(var i=0; i<10; i++){alert(i);}，请问该段循环一共执行几次alert()语句?( )。","options":[{"label":"A","text":"1"},{"label":"B","text":"9"},{"label":"C","text":"10"},{"label":"D","text":"0"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":82,"type":"单选","title":"82. (单选题) 在JavaScript中，已知有var t = document.getElementById(\"test\");以下哪句可以更改该元素t背景色为蓝色?( )。","options":[{"label":"A","text":"t.backgroundColor = \"blue\";"},{"label":"B","text":"t.style.background-color = \"blue\";"},{"label":"C","text":"t.style.backgroundColor = \"blue\";"},{"label":"D","text":"t.background-color = \"blue\";"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":83,"type":"单选","title":"83. (单选题) 在HTML页面中直接插入JavaScript代码的正确做法是使用何种标签?( )。","options":[{"label":"A","text":"<div></div>标签"},{"label":"B","text":"<js></js>标签"},{"label":"C","text":"<script></script>标签"},{"label":"D","text":"<p></p>标签"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":84,"type":"单选","title":"84. (单选题) 在JavaScript中，已知有以下代码:function testEven(num){if(num % 2 != 0) return;alert(num +\"是偶数!\");}请问调用该函数执行testEven(99);会出现什么结果?( )","options":[{"label":"A","text":"程序报错。"},{"label":"B","text":"不会弹出提示框。"},{"label":"C","text":"弹出alert提示框，并提示“99是偶数”。"},{"label":"D","text":"弹出alert提示框，并提示“99不是偶数”。"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":85,"type":"单选","title":"85. (单选题) 在JavaScript中，以下哪个事件指的是元素失去焦点?( )。","options":[{"label":"A","text":"onfocus"},{"label":"B","text":"onblur"},{"label":"C","text":"onselect"},{"label":"D","text":"onchange"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":86,"type":"单选","title":"86. (单选题) 引用JavaScript外部脚本的正确写法是?( )。","options":[{"label":"A","text":"<script src=\"JavaScript文件URL\"></script>"},{"label":"B","text":"<link src=\"JavaScript文件URL\"></link>"},{"label":"C","text":"<meta src=\"JavaScript文件URL\"></meta>"},{"label":"D","text":"<title src=\"JavaScript文件URL\"></title>"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":87,"type":"单选","title":"87. (单选题) 已知有var msg = \"happy\";且var k1 = msg.substring(1,-1); var k2 = slice(1,-1);请问k1和k2的取值分别是多少?( )。","options":[{"label":"A","text":"k1取值为\"h\"，k2取值为\"hap\"。"},{"label":"B","text":"k1取值为\"y\"，k2取值为\"hap\"。"},{"label":"C","text":"k1取值为\"h\"，k2取值为\"app\"。"},{"label":"D","text":"k1取值为\"y\"，k2取值为\"app\"。"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":88,"type":"单选","title":"88. (单选题) 在JavaScript中，已知有以下代码: var people = new Object();people.name = \"Mary\";people.age = 20; 则执行for(x in people){ alert(people[x]); }会出现何种结果?( )。","options":[{"label":"A","text":"只弹一次alert提示框，显示\"Mary\"。"},{"label":"B","text":"弹两次alert提示框，第一次显示\"Mary\"，第二次显示20。"},{"label":"C","text":"弹两次alert提示框，第一次显示\"name\"，第二次显示\"age\"。"},{"label":"D","text":"报错，因为people对象没有x属性。"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":89,"type":"单选","title":"89. (单选题) 在JavaScript中，使用document.write(\"HelloWorld\");可以往HTML页面动态输出文本内容，请问如果需要在这两个单词之间输出换行需要使用以下哪种方式?( )。","options":[{"label":"A","text":"document.write(\"Hello\\nWorld\");"},{"label":"B","text":"document.write(\"Hello<br>World\");"},{"label":"C","text":"document.write(\"Hello/nWorld\");"},{"label":"D","text":"document.write(\"Hello<enter>World\");"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":90,"type":"单选","title":"90. (单选题) 在JavaScript中，以下哪些变量的声明是不正确的?( )","options":[{"label":"A","text":"var test;"},{"label":"B","text":"var 123test;"},{"label":"C","text":"var $test;"},{"label":"D","text":"var _test;"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":91,"type":"单选","title":"91. (单选题) 在JavaScript中，已知有以下代码:function total(num1, num2){return num1+num2;}var rs = total(20,\"25\");请问rs的值是多少?( )","options":[{"label":"A","text":"45"},{"label":"B","text":"\"20+25\""},{"label":"C","text":"\"2025\""},{"label":"D","text":"NaN"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":92,"type":"单选","title":"92. (单选题) 在JavaScript中，以下哪句代码可以创建一个新的段落标签<p>?( )。","options":[{"label":"A","text":"document.createElements(\"p\");"},{"label":"B","text":"document.appendElement(\"p\");"},{"label":"C","text":"document.createElement(\"p\");"},{"label":"D","text":"document.appendElements(\"p\");"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":93,"type":"单选","title":"93. (单选题) 已知var x = 12; var y = \"34\";var k = x + y;则k的值是?( )。","options":[{"label":"A","text":"\"1234\""},{"label":"B","text":"12 + 34"},{"label":"C","text":"46"},{"label":"D","text":"xy"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":94,"type":"单选","title":"94. (单选题) 已知有var x = 3.14e7;请问x的取值等同于以下哪个?( )。","options":[{"label":"A","text":"3140000000"},{"label":"B","text":"3.140000000"},{"label":"C","text":"31400000"},{"label":"D","text":"3.14的7次方"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":95,"type":"单选","title":"95. (单选题) 在JavaScript中，已知有以下代码:var sum = 1, i = 4;do{sum = sum * i;i--;} while(i>1)alert(sum);请问alert提示框中显示的内容是?( )","options":[{"label":"A","text":"\"sum\""},{"label":"B","text":"12"},{"label":"C","text":"24"},{"label":"D","text":"1"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":96,"type":"单选","title":"96. (单选题) 在JavaScript中，假设已有元素p1表示新创建的段落元素<p>，且有元素t表示页面上已存在的<div>元素，如何将p1追加到t元素内部?( )。","options":[{"label":"A","text":"p1.appendChild(t);"},{"label":"B","text":"p1.append(t);"},{"label":"C","text":"t.appendChild(p1);"},{"label":"D","text":"t.append(p1);"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":97,"type":"单选","title":"97. (单选题) 已知有var x = 0xA;请问x的取值等同于十进制的哪个数字?( )。","options":[{"label":"A","text":"0"},{"label":"B","text":"1"},{"label":"C","text":"8"},{"label":"D","text":"10"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":98,"type":"单选","title":"98. (单选题) 已知有var x = 0.9999;var k = x.toFixed(2);请问k的取值会是多少?( )。","options":[{"label":"A","text":"1"},{"label":"B","text":"1.00"},{"label":"C","text":"0.99"},{"label":"D","text":"0.00"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":99,"type":"单选","title":"99. (单选题) 已知有var x = 9e30000;请问alert(x)时显示的内容是什么?( )。","options":[{"label":"A","text":"9e30000"},{"label":"B","text":"9000"},{"label":"C","text":"NaN"},{"label":"D","text":"Infinity"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":100,"type":"单选","title":"100. (单选题) 已知有var x1 = Boolean(\"hello\");var x2 = Boolean(0);请问x1和x2的返回值分别是什么?( )。","options":[{"label":"A","text":"x1返回值是false，x2返回值是true。"},{"label":"B","text":"x1返回值是true，x2返回值是false。"},{"label":"C","text":"x1返回值是false，x2返回值是false。"},{"label":"D","text":"x1返回值是true，x2返回值是true。"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":101,"type":"单选","title":"101. (单选题) 已知有var mobile = new Array(\"苹果\", \"三星\", \"华为\");var x = mobile[2];请问x的取值是?( )。","options":[{"label":"A","text":"\"苹果\""},{"label":"B","text":"\"三星\""},{"label":"C","text":"\"华为\""},{"label":"D","text":"以上均不正确。"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":102,"type":"单选","title":"102. (单选题) 以下变量定义不正确的有( )。","options":[{"label":"A","text":"var a, b=10;"},{"label":"B","text":"var a=12;"},{"label":"C","text":"var a, var b;"},{"label":"D","text":"var a=b=10;"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":103,"type":"单选","title":"103. (单选题) 关于DOM模型说法不正确的有( )。","options":[{"label":"A","text":"document对象是DOM模型的根节点"},{"label":"B","text":"DOM模型是一种与浏览器、平台和语言无关的接口"},{"label":"C","text":"DOM模型应用于HTML或者XML，用于动态访问文档的结构、内容及样式"},{"label":"D","text":"DOM模型与浏览器对象模型无关"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":104,"type":"单选","title":"104. (单选题) 下列关于DOM模型节点访问，说法正确的有( )。","options":[{"label":"A","text":"可以根据节点id访问DOM节点"},{"label":"B","text":"getElementsByTagName方法根据节点的name属性访问节点"},{"label":"C","text":"getElementsByName方法的作用是获取一个指定name属性值的节点"},{"label":"D","text":"nodeValue属性可以访问节点的value属性值"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":105,"type":"单选","title":"105. (单选题) 下面事件中属于表单提交事件的是( )。","options":[{"label":"A","text":"onload事件"},{"label":"B","text":"onclick事件"},{"label":"C","text":"onsubmit事件"},{"label":"D","text":"onfocus事件"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":106,"type":"单选","title":"106. (单选题) 下列选项中不属于JavaScript基本数据类型的有( )。","options":[{"label":"A","text":"String"},{"label":"B","text":"Number"},{"label":"C","text":"Boolean"},{"label":"D","text":"Class"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":107,"type":"单选","title":"107. (单选题) 在String对象中，能够查找子字符串出现位置的方法是( )。","options":[{"label":"A","text":"indexof方法"},{"label":"B","text":"lastIndexof方法"},{"label":"C","text":"split方法"},{"label":"D","text":"match方法"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":108,"type":"单选","title":"108. (单选题) 以下关于substr和substring方法描述错误的有( )。","options":[{"label":"A","text":"substr方法用于截取指定长度的子字符串"},{"label":"B","text":"substring方法用于截取指定长度的子字符串"},{"label":"C","text":"substr方法从start下标开始的指定数目的字符"},{"label":"D","text":"\"hello word!\".substring(5) 用于截取第5个字符后的所有字符"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":109,"type":"单选","title":"109. (单选题) 以下不属于浏览器对象的有( )。","options":[{"label":"A","text":"Date"},{"label":"B","text":"window"},{"label":"C","text":"document"},{"label":"D","text":"Location"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":110,"type":"单选","title":"110. (单选题) 以下( )选项是浏览器模型中的顶层对象。","options":[{"label":"A","text":"window"},{"label":"B","text":"document"},{"label":"C","text":"history"},{"label":"D","text":"Location"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":111,"type":"单选","title":"111. (单选题) 下列关于浏览器对象说法错误的是( )。","options":[{"label":"A","text":"window对象是浏览器模型的顶层对象"},{"label":"B","text":"document代表整个HTML文档"},{"label":"C","text":"location对象的forward方法可以实现浏览器的前进功能"},{"label":"D","text":"history对象用于管理当前窗口最近访问过的URL"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":112,"type":"单选","title":"112. (单选题) 以下哪个是新增记号标签?( )。","options":[{"label":"A","text":"<mark>"},{"label":"B","text":"<pregress>"},{"label":"C","text":"<meter>"},{"label":"D","text":"<aside>"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":113,"type":"单选","title":"113. (单选题) 关于新增的HTML5文档结构标签，以下哪种说法是错误的?( )。","options":[{"label":"A","text":"<header>是页眉标签，可以用于定义整个文档或某一节的标题。"},{"label":"B","text":"<footer>是页脚标签，可以用于定义整个文档或某一节的页脚。"},{"label":"C","text":"<nav>是导航标签，可以用于定义导航栏菜单。"},{"label":"D","text":"<article>是侧栏标签，可以用于定义网页两侧的侧栏内容。"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":114,"type":"单选","title":"114. (单选题) HTML5的正确doctype是( )。","options":[{"label":"A","text":"<!DOCTYPE html>"},{"label":"B","text":"<!DOCTYPE HTML5>"},{"label":"C","text":"<!DOCTYPE HTML PUBLIC \"-//W3C//DTD HTML 5.0//EN\" \"http://www.w3.org/TR/html5/strict.dtd\">"},{"label":"D","text":"以上都不是"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":115,"type":"单选","title":"115. (单选题) 用于播放 HTML5 视频文件的正确 HTML5 元素是( )。","options":[{"label":"A","text":"<media>"},{"label":"B","text":"<audio></audio>"},{"label":"C","text":"<video></video>"},{"label":"D","text":"<movie>"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":116,"type":"单选","title":"116. (单选题) 在HTML5中，规定输入字段是必填的属性是( )。","options":[{"label":"A","text":"required"},{"label":"B","text":"formvalidate"},{"label":"C","text":"validate"},{"label":"D","text":"placeholder"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":117,"type":"单选","title":"117. (单选题) 下列属于输入类型为定义滑块控件的是( )。","options":[{"label":"A","text":"search"},{"label":"B","text":"controls"},{"label":"C","text":"slider"},{"label":"D","text":"range"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":118,"type":"单选","title":"118. (单选题) 下列输入类型用于定义周和年控件(无时区)是( )。","options":[{"label":"A","text":"date"},{"label":"B","text":"week"},{"label":"C","text":"year"},{"label":"D","text":"time"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":119,"type":"单选","title":"119. (单选题) 以下哪一组不属于HTML5新增文档结构标签?( )。","options":[{"label":"A","text":"<header>和<footer>"},{"label":"B","text":"<nav>和<section>"},{"label":"C","text":"<article>和<aside>"},{"label":"D","text":"<head>和<body>"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":120,"type":"单选","title":"120. (单选题) 以下哪个是新增度量标签?( )。","options":[{"label":"A","text":"<p><mark> </p>"},{"label":"B","text":"<p><progress> </p>"},{"label":"C","text":"<meter>"},{"label":"D","text":"<aside>"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":121,"type":"单选","title":"121. (单选题) 以下哪个是新增进度标签?( )。","options":[{"label":"A","text":"<mark>"},{"label":"B","text":"<p><progress> </p>"},{"label":"C","text":"<meter>"},{"label":"D","text":"<aside>"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":122,"type":"单选","title":"122. (单选题) 在CSS3中，以下哪个属性可以用于为元素设置矩形边框的阴影效果?( )。","options":[{"label":"A","text":"border-radius"},{"label":"B","text":"box-shadow"},{"label":"C","text":"border-image"},{"label":"D","text":"border-bottom"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":123,"type":"单选","title":"123. (单选题) 在CSS3中，关于圆角边框的取值以下哪个说法是不正确的?( )。","options":[{"label":"A","text":"取值可以是长度值或者是百分比。"},{"label":"B","text":"取值不可以是负数。"},{"label":"C","text":"数字越大则圆角的弧度越明显。"},{"label":"D","text":"该属性值表示圆角边框的圆角直径长度。"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":124,"type":"单选","title":"124. (单选题) 在CSS3中，以下哪个属性可以单独设置边框右上角的弧度?( )。","options":[{"label":"A","text":"border-top-left-radius"},{"label":"B","text":"border-top-right-radius"},{"label":"C","text":"border-bottom-left-radius"},{"label":"D","text":"border-bottom -right-radius"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":125,"type":"单选","title":"125. (单选题) 在CSS3中给元素设置一个宽15像素的银色矩形阴影，如果希望该阴影在元素右下角出现(水平方向和垂直方向都偏移10像素)，以下哪个写法正确?( )。","options":[{"label":"A","text":"box-shadow:10px 10px 15px silver;"},{"label":"B","text":"box-shadow:-10px 10px 15px silver;"},{"label":"C","text":"box-shadow:10px -10px 15px silver;"},{"label":"D","text":"box-shadow:-10px -10px 15px silver;"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":126,"type":"单选","title":"126. (单选题) 在CSS3中,以下哪个不属于background-size属性允许的取值?( )。","options":[{"label":"A","text":"50%"},{"label":"B","text":"cover"},{"label":"C","text":"contain"},{"label":"D","text":"100s"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":127,"type":"单选","title":"127. (单选题) 在CSS3中，假设有背景图片原图尺寸为宽400px、高800px。样式background-size:200px;可以将其缩放成何种尺寸，以下哪种说法正确?( )。","options":[{"label":"A","text":"宽高均缩放为200px。"},{"label":"B","text":"宽度缩放为200px、高度缩放为400px。"},{"label":"C","text":"宽度缩放为200px、高度不变仍然是800px。"},{"label":"D","text":"宽度不变仍然是400px、高度缩放为200px。"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":128,"type":"单选","title":"128. (单选题) 在CSS3中关于字体的说法不正确的是?( )。","options":[{"label":"A","text":"浏览器只能显示设备上已经安装的字体。"},{"label":"B","text":"浏览器可以使用@font-face来规定显示特殊字体。"},{"label":"C","text":"浏览器可以使用font-family来定义自定义名称的字体。"},{"label":"D","text":"浏览器可以显示放在服务器端的特殊字体。"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":129,"type":"单选","title":"129. (单选题) 在CSS3中，以下哪个方法可以用于元素尺寸的放大缩小?( )。","options":[{"label":"A","text":"translate(x, y)"},{"label":"B","text":"rotate(degree)"},{"label":"C","text":"scale(x, y)"},{"label":"D","text":"skew(xdeg, ydeg)"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":130,"type":"单选","title":"130. (单选题) 在CSS3中，以下哪个方法可以用于元素顺时针或逆时针旋转?( )。","options":[{"label":"A","text":"scale(x, y)"},{"label":"B","text":"translate(x, y)"},{"label":"C","text":"skew(xdeg, ydeg)"},{"label":"D","text":"rotate(degree)"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":131,"type":"单选","title":"131. (单选题) 在CSS3中，以下哪个方法可以用于元素水平方向或垂直方向上平移位置?( )。","options":[{"label":"A","text":"translate(x, y)"},{"label":"B","text":"rotate(degree)"},{"label":"C","text":"scale(x, y)"},{"label":"D","text":"skew(xdeg, ydeg)"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":132,"type":"单选","title":"132. (单选题) 在CSS3技术的Transition动画属性中，以下哪个可以用于设置动画的持续时间?( )。","options":[{"label":"A","text":"transition-delay"},{"label":"B","text":"transition-duration"},{"label":"C","text":"transition-timing-function"},{"label":"D","text":"transition-property"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":133,"type":"单选","title":"133. (单选题) 在CSS3技术的Transition动画属性中，以下哪个可以用于设置动画的渐变速度?( )。","options":[{"label":"A","text":"transition-delay"},{"label":"B","text":"transition-duration"},{"label":"C","text":"transition-timing-function"},{"label":"D","text":"transition-property"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":134,"type":"单选","title":"134. (单选题) 在CSS3中，transition-timing-function属性取值为linear时指的是什么意思?( )。","options":[{"label":"A","text":"动画的渐变速度为匀速渐变。"},{"label":"B","text":"动画的渐变速度为逐渐变慢。"},{"label":"C","text":"动画的渐变速度为先加速后减速。"},{"label":"D","text":"动画的渐变速度为减速。"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":135,"type":"单选","title":"135. (单选题) 在CSS3中，如果设置动画渐变的延迟时间为10秒，以下哪句代码写法是正确的?( )。","options":[{"label":"A","text":"transition-delay: 10ms"},{"label":"B","text":"transition-delay: 1000ms"},{"label":"C","text":"transition-delay: 10m"},{"label":"D","text":"transition-delay: 10s"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":136,"type":"单选","title":"136. (单选题) 把元素设为可拖动，需加属性","options":[{"label":"A","text":"drop=\"true\""},{"label":"B","text":"B. drag=\"true\""},{"label":"C","text":"C. draggable=\"true\""},{"label":"D","text":"D. movable=\"true\""}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":137,"type":"单选","title":"137. (单选题) 在 dragstart 事件里保存拖拽数据，应使用","options":[{"label":"A","text":"event.data"},{"label":"B","text":"event.detail"},{"label":"C","text":"event.dataTransfer"},{"label":"D","text":"event.dragData"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":138,"type":"单选","title":"138. (单选题) 允许放置元素触发 drop 事件，必须在 dragover 处理器内","options":[{"label":"A","text":"返回 true"},{"label":"B","text":"调用 preventDefault()"},{"label":"C","text":"设置 dropable=true"},{"label":"D","text":"什么都不做"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":139,"type":"单选","title":"139. (单选题) Canvas 2D 上下文获取方法是","options":[{"label":"A","text":"getCanvas()"},{"label":"B","text":"getContext(\"2d\")"},{"label":"C","text":"get2D()"},{"label":"D","text":"context(\"2d\")"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":140,"type":"单选","title":"140. (单选题) 在 Canvas 中绘制填充矩形，使用","options":[{"label":"A","text":"strokeRect()"},{"label":"B","text":"fillRect()"},{"label":"C","text":"rect()"},{"label":"D","text":"drawRect()"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":141,"type":"单选","title":"141. (单选题) 设置 Canvas 画笔颜色，修改属性","options":[{"label":"A","text":"fillStyle"},{"label":"B","text":"fillColor"},{"label":"C","text":"color"},{"label":"D","text":"brushColor"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":142,"type":"单选","title":"142. (单选题) 绘制圆弧的核心函数是","options":[{"label":"A","text":"arc()"},{"label":"B","text":"circle()"},{"label":"C","text":"drawArc()"},{"label":"D","text":"curve()"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":143,"type":"单选","title":"143. (单选题) 若 Canvas 宽高在 CSS 中设置，而未在 HTML 属性设置，会导致","options":[{"label":"A","text":"绘图区域不变"},{"label":"B","text":"坐标系拉伸变形"},{"label":"C","text":"无法绘图"},{"label":"D","text":"自动清空"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":144,"type":"单选","title":"144. (单选题) 在浏览器中持久化存储大量字符串数据，优先使用","options":[{"label":"A","text":"cookie"},{"label":"B","text":"localStorage"},{"label":"C","text":"sessionStorage"},{"label":"D","text":"cache"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":145,"type":"单选","title":"145. (单选题) 关闭标签页即自动清除的存储对象是","options":[{"label":"A","text":"localStorage"},{"label":"B","text":"sessionStorage"},{"label":"C","text":"cookie"},{"label":"D","text":"indexDB"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":146,"type":"单选","title":"146. (单选题) 向 localStorage 写入数据，正确语法是","options":[{"label":"A","text":"localStorage.setItem(key, value)"},{"label":"B","text":"localStorage[key] = value"},{"label":"C","text":"localStorage.write(key, value)"},{"label":"D","text":"A 与 B 均可"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":147,"type":"单选","title":"147. (单选题) 使用 XMLHttpRequest 发起异步请求，默认方法为","options":[{"label":"A","text":"GET"},{"label":"B","text":"POST"},{"label":"C","text":"PUT"},{"label":"D","text":"HEAD"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":148,"type":"单选","title":"148. (单选题) 与服务器保持长连接、实现全双工通信的最佳技术是","options":[{"label":"A","text":"Ajax 轮询"},{"label":"B","text":"Server-Sent Events"},{"label":"C","text":"WebSocket"},{"label":"D","text":"fetch"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":149,"type":"单选","title":"149. (单选题) 关于正则表达式说法不正确的是( )。","options":[{"label":"A","text":"正则表达式是一种对文字进行模糊匹配的语言"},{"label":"B","text":"正则表达式可以实现数据格式的有效性验证"},{"label":"C","text":"正则表达式可以替换和删除文本中满足某种模式的内容"},{"label":"D","text":"正则表达式的模式匹配不能实现区分大小写"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":150,"type":"单选","title":"150. (单选题) 关于正则表达式中的方法，说法正确的是( )。","options":[{"label":"A","text":"exec方法的作用是执行一段JavaScript脚本"},{"label":"B","text":"test方法用于测试正则表达式的有效性"},{"label":"C","text":"match方法用于匹配模式字符串，并返回所有的匹配结果"},{"label":"D","text":"exec方法的作用是搜索符合正则表达式模式字符串的内容难以程度:中"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":151,"type":"单选","title":"151. (判断题) JavaScript是Java的一个版本，是由Sun公司的James Gosling发明的一种面向对象语言。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":152,"type":"单选","title":"152. (判断题) Web具有平台无关性的特点，可以运行在不同的操作系统上。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":153,"type":"单选","title":"153. (判断题) Web系统由Web服务器、浏览器和通信协议组成。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":154,"type":"单选","title":"154. (判断题) CSS3不兼容CSS2的语法，原先基于CSS2设计的网页内容需要重写代码方可正常显示。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":155,"type":"单选","title":"155. (判断题) ＜strong＞＜/strong＞标记与＜b＞＜/b＞标记作用相同。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":156,"type":"单选","title":"156. (判断题) 一对段落缩进(块引用)blockquote标记可以实现在块引用标记所包围的内容的首部留出5个空格的位置。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":157,"type":"单选","title":"157. (判断题) 如果希望字体加粗，使用标签<b>或者<strong>都可以做到。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":158,"type":"单选","title":"158. (判断题) 可以使用<br>或者&nbsp来表示换行。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":159,"type":"单选","title":"159. (判断题) 有序列表的type属性可以设置为“A”以大写字母编号。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":160,"type":"单选","title":"160. (判断题) list-style-type属性不能设置为“none”。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":161,"type":"单选","title":"161. (判断题) dl标签用于创建定义列表?","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":162,"type":"单选","title":"162. (判断题) 锚点链接只能跳转到当前页面的指定位置。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":163,"type":"单选","title":"163. (判断题) hover 伪类只能用于超链接，不能用于其他元素。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":164,"type":"单选","title":"164. (判断题) img标签的alt 属性内容会在鼠标悬停时显示。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":165,"type":"单选","title":"165. (判断题) <table> 必须包含 <tbody> 标签才能正常显示。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":166,"type":"单选","title":"166. (判断题) rowspan=\"2\" 表示单元格纵向跨越两行。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":167,"type":"单选","title":"167. (判断题) <input type=\"email\"> 会自动验证是否包含 @ 符号。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":168,"type":"单选","title":"168. (判断题) checkbox 与 radio 控件都必须写 value 属性才能提交数据。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":169,"type":"单选","title":"169. (判断题) 使用 GET 方式提交表单时，数据放在请求体中。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":170,"type":"单选","title":"170. (判断题) CSS 负责网页的结构与语义，HTML 负责表现。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":171,"type":"单选","title":"171. (判断题) 外部样式表可以被多个 HTML 页面共享引用。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":172,"type":"单选","title":"172. (判断题) 行内样式的优先级高于外部和内部样式。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":173,"type":"单选","title":"173. (判断题) text-align: center 能让块级元素自身水平居中。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":174,"type":"单选","title":"174. (判断题) nav > li 只会选中 .nav 的直接子元素 li。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":175,"type":"单选","title":"175. (判断题) div p 与 div > p 在选择范围上完全相同。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":176,"type":"单选","title":"176. (判断题) 选择器 .box:hover 表示鼠标悬停在 .box 上时的状态。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":177,"type":"单选","title":"177. (判断题) padding 值可为负。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":178,"type":"单选","title":"178. (判断题) 设置 display:inline-block 后，元素不再具有盒模型属性。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":179,"type":"单选","title":"179. (判断题) position: static 元素可以使用 top/left 进行偏移。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":180,"type":"单选","title":"180. (判断题) z-index 值越大，元素越靠近用户。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":181,"type":"单选","title":"181. (判断题) 绝对定位元素会脱离普通文档流。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":182,"type":"单选","title":"182. (判断题) JavaScript不允许使用一个关键词var同时定义多个变量，每声明一个变量都必须重新使用一次关键词var，例如var x1; var x2; var x3;必须分开定义。( )","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":183,"type":"单选","title":"183. (判断题) 在JavaScript中，onclick事件指的是元素被鼠标左键单击。( )","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":184,"type":"单选","title":"184. (判断题) JavaScript语言是一种大小写敏感的语言，例如字母a和A会被认为是不同的内容。( )","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":185,"type":"单选","title":"185. (判断题) 虽然JavaScript变量是弱类型的，同一个变量不可以用于存放不同类型的值。例如假设已有var x = 9;则后面只能使用x存放数字。( )","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":186,"type":"单选","title":"186. (判断题) JavaScript程序在编写后只能在Windows操作系统中运行。( )","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":187,"type":"单选","title":"187. (判断题) JavaScript需要定义变量的类型，在变量声明时可以使用int表示整型、String表示字符串。( )","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":188,"type":"单选","title":"188. (判断题) 在JavaScript中，history.back()指的是前进到下一个页面，相当于点击了浏览器上的前进按钮。( )","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":189,"type":"单选","title":"189. (判断题) 在HTML文档引用外部JavaScript文件时，引用语句必须放在<head>首尾标签中。( )","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":190,"type":"单选","title":"190. (判断题) 在JavaScript中，已知有var x = true;则x属于string类型。( )","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":191,"type":"单选","title":"191. (判断题) 在JavaScript中可使用match()或search()方法查找匹配正则表达式的字符串内容。( )","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":192,"type":"单选","title":"192. (判断题) 在JavaScript中有var x = 020;则alert(x);显示的数字是20。( )","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":193,"type":"单选","title":"193. (判断题) nav标记代表页面的一部分，是一个可以作为页面导航的链接组。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":194,"type":"单选","title":"194. (判断题) 记号mark 标记用来定义带有记号的文本。在需要突出显示文本时可以使用mark 标记。此标记对关键字做高亮处理(蓝底色标注)，突出显示，标注重点，在搜索方面可以应用。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":195,"type":"单选","title":"195. (判断题) 设置video标记的preload属性，则视频在页面加载时进行加载，并预备播放。如果使用autoplay，则忽略该属性。该属性有三种值:auto、metadata、none。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":196,"type":"单选","title":"196. (判断题) 使用source 标记只能给audio 标记提供不同格式的音频文件，浏览器将使用第一个支持的音频文件。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":197,"type":"单选","title":"197. (判断题) CSS3不兼容CSS2的语法，原先基于CSS2设计的网页内容需要重写代码方可正常显示。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":198,"type":"单选","title":"198. (判断题) 所谓CSS3 动画，就是指元素从一种样式逐渐变化为另一种样式的效果。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":199,"type":"单选","title":"199. (判断题) 在@keyframes中规定某项CSS样式，只能定义CSS3动画开始时和动画结束时的两个状态的样式属性。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":200,"type":"单选","title":"200. (判断题) 在CSS3中，background-clip属性值为content-box可以保留边框本身及其内部的元素背景区域。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":201,"type":"单选","title":"201. (判断题) 在CSS3中，@keyframes属性可以用于设置动画的内容，内部只能包含0%和100%分别表示起始动画和结束，不允许有其它百分比。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":202,"type":"单选","title":"202. (判断题) 在CSS3中，animation: myFrame 10s;指的是在10毫秒之内执行自定义名称叫做myFrame的animation动画效果。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":203,"type":"单选","title":"203. (判断题) 在CSS3中，animation-direction属性的取值为normal时表示反方向运行动画。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":204,"type":"单选","title":"204. (判断题) 任何元素加 draggable=\"true\" 后都能直接触发 drop 事件，无需额外代码。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":205,"type":"单选","title":"205. (判断题) dragend 事件在松开鼠标时触发，无论是否成功放置。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":206,"type":"单选","title":"206. (判断题) Canvas 绘图方法 fillRect() 会同时产生路径记录，可用 fill()再次填充。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":207,"type":"单选","title":"207. (判断题) 通过 event.dataTransfer.setData() 可自定义拖拽数据格式与内容。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":208,"type":"单选","title":"208. (判断题) localStorage 存储的数据在浏览器重启后依然有效。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":209,"type":"单选","title":"209. (判断题) XMLHttpRequest 只能发起同域请求，不能实现 CORS。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":210,"type":"单选","title":"210. (判断题) WebSocket 连接建立后，客户端与服务器可互相主动推送数据。","options":[{"label":"true","text":"对"},{"label":"false","text":"错"}],"correctAnswer":[],"selectedAnswer":[],"images":[]},
  {"id":211,"type":"填空","title":"211. (简答题) 请分别简述HTML、CSS和JavaScript的作用。","options":[],"correctAnswer":["HTML、CSS、JavaScript的作用分别是： HTML：定义网页内容与结构（骨架） CSS：控制网页样式与布局（外观） JavaScript：实现网页交互与动态功能（行为）"],"selectedAnswer":["HTML、CSS、JavaScript的作用分别是： HTML：定义网页内容与结构（骨架） CSS：控制网页样式与布局（外观） JavaScript：实现网页交互与动态功能（行为）"],"images":[]},
  {"id":212,"type":"填空","title":"212. (简答题) 请简述URL的组成。","options":[],"correctAnswer":["URL主要由以下部分组成： 协议：如 http、https 主机名：域名或IP地址 端口号：服务器端口（可选） 路径：资源在服务器上的位置 查询参数：传递给服务器的数据（?开头） 片段标识符：页面内锚点（#开头）"],"selectedAnswer":["URL主要由以下部分组成： 协议：如 http、https 主机名：域名或IP地址 端口号：服务器端口（可选） 路径：资源在服务器上的位置 查询参数：传递给服务器的数据（?开头） 片段标识符：页面内锚点（#开头）"],"images":[]},
  {"id":213,"type":"填空","title":"213. (简答题) 简述可通过元信息标签<meta>设置哪些信息（回答至少5点）。","options":[],"correctAnswer":["可通过 <meta> 标签设置的5类主要信息： 文档字符编码：<meta charset=\"UTF-8\"> 视口设置（移动端适配）：<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"> 页面描述与关键词（SEO）：<meta name=\"description\" content=\"...\">、<meta name=\"keywords\" content=\"...\"> 作者版权信息：<meta name=\"author\" content=\"...\">、<meta name=\"copyright\" content=\"...\"> 页面重定向/刷新：<meta http-equiv=\"refresh\" content=\"...\"> 其他常见设置（可作为扩展）："],"selectedAnswer":["可通过 <meta> 标签设置的5类主要信息： 文档字符编码：<meta charset=\"UTF-8\"> 视口设置（移动端适配）：<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"> 页面描述与关键词（SEO）：<meta name=\"description\" content=\"...\">、<meta name=\"keywords\" content=\"...\"> 作者版权信息：<meta name=\"author\" content=\"...\">、<meta name=\"copyright\" content=\"...\"> 页面重定向/刷新：<meta http-equiv=\"refresh\" content=\"...\"> 其他常见设置（可作为扩展）："],"images":[]},
  {"id":214,"type":"填空","title":"214. (简答题) 简述HTML中三种列表类型的特点及适用场景。","options":[],"correctAnswer":["无序列表 (<ul>): 项目顺序不重要，带符号标记，适用于导航、分类等 有序列表 (<ol>): 项目有明确顺序，带数字编号，适用于步骤、排名等 定义列表 (<dl>): 包含术语(<dt>)和描述(<dd>)，适用于词汇表、问答等"],"selectedAnswer":["无序列表 (<ul>): 项目顺序不重要，带符号标记，适用于导航、分类等 有序列表 (<ol>): 项目有明确顺序，带数字编号，适用于步骤、排名等 定义列表 (<dl>): 包含术语(<dt>)和描述(<dd>)，适用于词汇表、问答等"],"images":[]},
  {"id":215,"type":"填空","title":"215. (简答题) 简要说明“外部样式表”相对于“行内样式”的三大优势。","options":[],"correctAnswer":["外部样式表的三大优势： 可维护性高：实现内容与表现分离，修改样式只需编辑CSS文件 可复用性强：一份CSS可被多个页面共享，减少代码冗余 可管理性好：遵循CSS层叠规则，支持模块化，便于调试和维护"],"selectedAnswer":["外部样式表的三大优势： 可维护性高：实现内容与表现分离，修改样式只需编辑CSS文件 可复用性强：一份CSS可被多个页面共享，减少代码冗余 可管理性好：遵循CSS层叠规则，支持模块化，便于调试和维护"],"images":[]},
  {"id":216,"type":"填空","title":"216. (简答题) 简述 absolute 与 fixed 定位在参考系、脱离文档流和适用场景三方面的区别。","options":[],"correctAnswer":["参考系：absolute相对于最近的定位祖先元素，fixed相对于浏览器视口。 文档流：两者都完全脱离文档流，但fixed不随页面滚动。 场景：absolute用于相对父元素定位（如下拉菜单），fixed用于固定位置元素（如导航栏）。"],"selectedAnswer":["参考系：absolute相对于最近的定位祖先元素，fixed相对于浏览器视口。 文档流：两者都完全脱离文档流，但fixed不随页面滚动。 场景：absolute用于相对父元素定位（如下拉菜单），fixed用于固定位置元素（如导航栏）。"],"images":[]},
  {"id":217,"type":"填空","title":"217. (简答题) JavaScript有哪些原始数据类型（基本数据类型）?","options":[],"correctAnswer":["string，int，boolean，number，null，undefined，symbol,bigint"],"selectedAnswer":["string，int，boolean，number，null，undefined，symbol,bigint"],"images":[]},
  {"id":218,"type":"填空","title":"218. (简答题) 请说明JavaScript中typeof运算符的作用及其返回的几种结果。","options":[],"correctAnswer":["作用：检测操作数的数据类型，返回类型名称的字符串。 8种返回值： 基本类型：\"undefined\"、\"boolean\"、\"number\"、\"string\"、\"bigint\"、\"symbol\" 引用类型：\"function\"、\"object\" 重要特性： typeof null === \"object\"（历史遗留问题） 能准确检测函数类型（返回\"function\"） 检测未声明变量不会报错（返回\"undefined\"） 局限性：无法区分数组、普通对象、日期等（都返回\"object\"）。"],"selectedAnswer":["作用：检测操作数的数据类型，返回类型名称的字符串。 8种返回值： 基本类型：\"undefined\"、\"boolean\"、\"number\"、\"string\"、\"bigint\"、\"symbol\" 引用类型：\"function\"、\"object\" 重要特性： typeof null === \"object\"（历史遗留问题） 能准确检测函数类型（返回\"function\"） 检测未声明变量不会报错（返回\"undefined\"） 局限性：无法区分数组、普通对象、日期等（都返回\"object\"）。"],"images":[]},
  {"id":219,"type":"填空","title":"219. (简答题) 简述 HTML5 原生表单验证的三种常用方式，并各举一例。","options":[],"correctAnswer":["类型验证：通过 type=\"email|url|number|date\" 等特定类型进行格式验证 必填验证：通过 required 属性确保字段不为空模式验证：通过 pattern 属性使用正则表达式自定义验证规则"],"selectedAnswer":["类型验证：通过 type=\"email|url|number|date\" 等特定类型进行格式验证 必填验证：通过 required 属性确保字段不为空模式验证：通过 pattern 属性使用正则表达式自定义验证规则"],"images":[]},
  {"id":220,"type":"填空","title":"220. (简答题) HTML5中新增的表单元素类型有哪些?","options":[],"correctAnswer":["HTML5新增的表单输入类型包括： ① email（邮箱）、② url（网址）、③ tel（电话）、④ search（搜索）、⑤ number（数字）、⑥ range（范围滑块）、⑦ date（日期）、⑧ time（时间）、⑨ datetime-local（本地日期时间）、⑩ month（月份）、⑪ week（周）、⑫ color（颜色选择）。"],"selectedAnswer":["HTML5新增的表单输入类型包括： ① email（邮箱）、② url（网址）、③ tel（电话）、④ search（搜索）、⑤ number（数字）、⑥ range（范围滑块）、⑦ date（日期）、⑧ time（时间）、⑨ datetime-local（本地日期时间）、⑩ month（月份）、⑪ week（周）、⑫ color（颜色选择）。"],"images":[]},
  {"id":221,"type":"填空","title":"221. (简答题) Localstorage和 Cookies（存储在用户本地终端上的数据）之间的区别是什么？","options":[],"correctAnswer":["Cookies用于客户端与服务器间的数据通信（自动携带在HTTP请求中）；LocalStorage用于纯粹的客户端本地数据存储（不自动发送给服务器）。"],"selectedAnswer":["Cookies用于客户端与服务器间的数据通信（自动携带在HTTP请求中）；LocalStorage用于纯粹的客户端本地数据存储（不自动发送给服务器）。"],"images":[]},
  {"id":222,"type":"填空","title":"222. (填空题) Web架构是由Web浏览器和____组成的，又称为B/S架构。","options":[],"correctAnswer":["Web服务器"],"selectedAnswer":["Web服务器"],"images":[]},
  {"id":223,"type":"填空","title":"223. (填空题) URL(uniform resource locator),中文名称为____是对可以从互联网上得到的资源的位置和访问方法的一种简洁的表示，是互联网上标准资源的地址。","options":[],"correctAnswer":["统一资源定位符"],"selectedAnswer":["统一资源定位符"],"images":[]},
  {"id":224,"type":"填空","title":"224. (填空题) 若要设置标题(h1-h6)居中，可通过___属性设置。","options":[],"correctAnswer":["align"],"selectedAnswer":["align"],"images":[]},
  {"id":225,"type":"填空","title":"225. (填空题) 要生成水平线，可用______标签。","options":[],"correctAnswer":["<hr/>"],"selectedAnswer":["<hr/>"],"images":[]},
  {"id":226,"type":"填空","title":"226. (填空题) 与标记<b></b>功能相同的标记是______。","options":[],"correctAnswer":["<strong></strong>"],"selectedAnswer":["<strong></strong>"],"images":[]},
  {"id":227,"type":"填空","title":"227. (填空题) 设置有序列表的 属性可以改变编号的起始值，该属性值的类型是整数型数值，表示从哪一个数字或字母开始编号。","options":[],"correctAnswer":["start"],"selectedAnswer":["start"],"images":[]},
  {"id":228,"type":"填空","title":"228. (填空题) 插入图片的基本语法:<img ____=\"路径\" alt=\"描述\">","options":[],"correctAnswer":["src"],"selectedAnswer":["src"],"images":[]},
  {"id":229,"type":"填空","title":"229. (填空题) 设置表单提交地址的属性是 ____。","options":[],"correctAnswer":["action"],"selectedAnswer":["action"],"images":[]},
  {"id":230,"type":"填空","title":"230. (填空题) 让下拉框支持多选，需要给 select 标签加 ____属性。","options":[],"correctAnswer":["multiple"],"selectedAnswer":["multiple"],"images":[]},
  {"id":231,"type":"填空","title":"231. (填空题) CSS 规则由选择器和 ____两部分组成。","options":[],"correctAnswer":["声明块"],"selectedAnswer":["声明块"],"images":[]},
  {"id":232,"type":"填空","title":"232. (填空题) 引用外部样式表使用的标签是 ____。","options":[],"correctAnswer":["<link>"],"selectedAnswer":["<link>"],"images":[]},
  {"id":233,"type":"填空","title":"233. (填空题) 去掉 a 标签默认下划线，用 text-decoration: ____。","options":[],"correctAnswer":["none"],"selectedAnswer":["none"],"images":[]},
  {"id":234,"type":"填空","title":"234. (填空题) 设置背景图完全覆盖容器且保持比例，用 background-size: ____;","options":[],"correctAnswer":["cover"],"selectedAnswer":["cover"],"images":[]},
  {"id":235,"type":"填空","title":"235. (填空题) 选中所有元素使用的选择器符号是 ____。","options":[],"correctAnswer":["*"],"selectedAnswer":["*"],"images":[]},
  {"id":236,"type":"填空","title":"236. (填空题) 选中 ul 直接子元素 li，选择器写 ____。","options":[],"correctAnswer":["ul > li"],"selectedAnswer":["ul > li"],"images":[]},
  {"id":237,"type":"填空","title":"237. (填空题) 盒模型由 content、padding、border 和 ____四部分组成。","options":[],"correctAnswer":["margin"],"selectedAnswer":["margin"],"images":[]},
  {"id":238,"type":"填空","title":"238. (填空题) HTML5新增媒体元素除了通过src属性可以加载媒介文件URL外，还可以通过____标记加载不同格式的媒介文件，以满足浏览器支持的需要。","options":[],"correctAnswer":["source"],"selectedAnswer":["source"],"images":[]},
  {"id":239,"type":"填空","title":"239. (填空题) HTML5新增____类型的input元素可以拾取颜色。","options":[],"correctAnswer":["color"],"selectedAnswer":["color"],"images":[]},
  {"id":240,"type":"填空","title":"240. (填空题) HTML5新增____类型的input元素可以限制只能输入数字，并可以微调。","options":[],"correctAnswer":["number"],"selectedAnswer":["number"],"images":[]},
  {"id":241,"type":"填空","title":"241. (填空题) 在CSS3中，border-top-____-radius属性用于定义边框左上角的弧度。(区分大小写)","options":[],"correctAnswer":["left"],"selectedAnswer":["left"],"images":[]},
  {"id":242,"type":"填空","title":"242. (填空题) 在CSS3中,text-shadow的默认属性值是 ____，表示无阴影效果。(区分大小写)","options":[],"correctAnswer":["none"],"selectedAnswer":["none"],"images":[]},
  {"id":243,"type":"填空","title":"243. (填空题) 在CSS3中，scaleY(____)表示高度缩放为原来的一半。","options":[],"correctAnswer":["0.5"],"selectedAnswer":["0.5"],"images":[]},
  {"id":244,"type":"填空","title":"244. (填空题) CSS3 过渡是元素从一种样式逐渐改变为另一种的效果。要实现这种效果，需要设置两个因素，分别是指定要添加效果的CSS属性、指定效果的____。","options":[],"correctAnswer":["持续时间"],"selectedAnswer":["持续时间"],"images":[]}
];

export const DEFAULT_BANKS: QuestionBank[] = [
  {
    id: 'default-python-1',
    name: 'Python程序设计',
    createdAt: 1765262408306,
    questions: PYTHON_BANK_QUESTIONS
  },
  {
    id: 'default-web-1',
    name: 'Web前端开发(考试)',
    createdAt: 1765250719562,
    questions: WEB_EXAM_BANK_QUESTIONS
  },
  {
    id: 'default-web-2',
    name: 'Web前端开发(作业)',
    createdAt: 1765255903193,
    questions: WEB_WORK_BANK_QUESTIONS
  }
];