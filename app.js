/* =========================================================
   嵌入式 C 可视化讲义 · 交互逻辑
   零依赖，所有演示都在本地计算
   ========================================================= */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const fmt = (v, pad) => '0x' + v.toString(16).toUpperCase().padStart(pad || 2, '0');
  const fmt32 = v => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0').replace(/^(.{4})/, '$1_');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- 目录高亮 ---------------- */
  (function tocSpy() {
    const links = new Map();
    const details = $('#tocDetails');
    const compact = window.matchMedia('(max-width: 1199px)');
    const current = $('#tocCurrent');
    function adaptNavigation() { details.open = !compact.matches; }
    adaptNavigation();
    compact.addEventListener('change', adaptNavigation);
    $$('.toc-link').forEach(link => link.addEventListener('click', () => {
      if (compact.matches) details.open = false;
    }));
    $$('.toc-link').forEach(a => links.set(a.getAttribute('href').slice(1), a));
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        links.forEach(l => {
          l.classList.remove('is-active');
          l.removeAttribute('aria-current');
        });
        const link = links.get(entry.target.id);
        if (link) {
          link.classList.add('is-active');
          link.setAttribute('aria-current', 'location');
          current.textContent = link.textContent;
        }
      });
    }, { rootMargin: '-20% 0px -68% 0px', threshold: 0 });
    $$('.chapter').forEach(section => io.observe(section));
  })();

  /* =========================================================
     01 · 内存地图
     ========================================================= */
  (function memoryLab() {
    const ram = $('#ram');
    if (!ram) return;

    const stackFramesEl = $('#stackFrames');
    const heapItemsEl = $('#heapItems');
    const segHeap = $('#segHeap');
    const freeKb = $('#freeKb');
    const heapTopEl = $('#memHeapTop');
    const spEl = $('#memSp');
    const gapEl = $('#memGap');
    const logEl = $('#memLog');
    const flashData = $('#flashData');
    const zeroFlash = $('#zeroFlash');
    const copyArrow = $('.copy-arrow');

    const SRAM_TOP = 0x5000;       // 20 KB
    const DATA_BASE = 0x000;
    const BSS_BASE = 0x100;
    const HEAP_BASE = 0x300;
    const FRAME_BYTES = 32;
    const MALLOC_BYTES = 64;

    let frames = [];
    let allocs = [];
    let overflow = false;
    let callSeq = 0;
    let timers = [];

    const addr = off => '0x2000_' + Math.max(0, off).toString(16).toUpperCase().padStart(4, '0');

    function setLog(text, cls) {
      logEl.textContent = text;
      logEl.className = 'stage-log' + (cls ? ' ' + cls : '');
    }

    function heapBytes() { return allocs.length * MALLOC_BYTES; }
    function heapTop() { return HEAP_BASE + heapBytes(); }
    function stackTop() {
      const used = frames.reduce((sum, frame) => sum + frame.bytes, 0);
      return SRAM_TOP - used;
    }

    function renderFrames() {
      stackFramesEl.innerHTML = '';
      const visible = frames.slice(-5);
      const hidden = frames.length - visible.length;
      if (hidden > 0) {
        const more = document.createElement('div');
        more.className = 'frame';
        more.innerHTML = '<span>…</span><span>+' + hidden + ' 层</span>';
        stackFramesEl.appendChild(more);
      }
      visible.forEach(frame => {
        const el = document.createElement('div');
        el.className = 'frame';
        el.innerHTML = '<span>' + frame.name + '</span><span>' + frame.bytes + ' B</span>';
        stackFramesEl.appendChild(el);
      });
    }

    function renderHeap() {
      heapItemsEl.innerHTML = '';
      allocs.forEach(() => {
        const el = document.createElement('i');
        el.style.width = '9px';
        el.title = MALLOC_BYTES + ' B';
        heapItemsEl.appendChild(el);
      });
      const rows = Math.ceil(allocs.length / 6);
      segHeap.style.height = (34 + rows * 12) + 'px';
    }

    function renderNumbers() {
      const ht = heapTop();
      const sp = stackTop();
      const gap = sp - ht;
      heapTopEl.textContent = addr(ht);
      spEl.textContent = addr(sp);
      if (overflow || gap < 0) {
        gapEl.textContent = '已越界';
        gapEl.style.color = 'var(--red)';
      } else {
        gapEl.style.color = '';
        gapEl.textContent = gap >= 1024 ? (gap / 1024).toFixed(1) + ' KB' : gap + ' B';
      }
      if (freeKb) freeKb.textContent = gap >= 1024 ? '≈ ' + (gap / 1024).toFixed(1) + ' KB' : gap + ' B';
    }

    function resetState() {
      timers.forEach(clearTimeout);
      timers = [];
      frames = [];
      allocs = [];
      overflow = false;
      callSeq = 0;
      ram.classList.remove('is-overflow');
      renderFrames();
      renderHeap();
      renderNumbers();
    }

    function powerOn() {
      resetState();
      setLog('复位：从 Flash 复制 .data 初值，把 .bss 清零…', 'info');
      if (copyArrow) copyArrow.classList.add('flow');
      flashData.classList.remove('is-copying');
      void flashData.offsetWidth;
      flashData.classList.add('is-copying');
      zeroFlash.classList.remove('run');
      void zeroFlash.offsetWidth;
      zeroFlash.classList.add('run');
      timers.push(setTimeout(() => {
        if (copyArrow) copyArrow.classList.remove('flow');
        setLog('启动完成：.data 有初值，.bss 全 0，堆栈就位。', 'ok');
      }, 1200));
    }

    $('#btnPower').addEventListener('click', powerOn);

    $('#btnCall').addEventListener('click', () => {
      if (overflow) powerOn();
      callSeq += 1;
      frames.push({ name: 'func_' + callSeq + '()', bytes: FRAME_BYTES });
      renderFrames();
      renderNumbers();
      const size = frames.reduce((sum, frame) => sum + frame.bytes, 0);
      setLog('调用 func_' + callSeq + '()：栈再向下长 ' + FRAME_BYTES + ' B，当前栈已用 ' + size + ' B。', 'info');
    });

    $('#btnMalloc').addEventListener('click', () => {
      if (overflow) powerOn();
      if (allocs.length >= 12) {
        setLog('示例堆只有 768 B；真实工程里碎片化会让分配更早失败。', 'bad');
        return;
      }
      allocs.push(MALLOC_BYTES);
      renderHeap();
      renderNumbers();
      setLog('malloc(' + MALLOC_BYTES + ' B)：堆向上长，返回的地址必须检查是否为 NULL。', 'info');
    });

    $('#btnOverflow').addEventListener('click', () => {
      if (overflow) { powerOn(); return; }
      frames.push({ name: 'big_buf[20480]', bytes: 20480 });
      overflow = true;
      ram.classList.add('is-overflow');
      renderFrames();
      renderNumbers();
      setLog('局部数组太大：栈越过可用空间，可能破坏堆/全局数据；不一定立即触发 HardFault。', 'bad');
    });

    powerOn();
  })();

  /* =========================================================
     02 · volatile
     ========================================================= */
  (function volatileLab() {
    const regEl = $('#volReg');
    if (!regEl) return;

    const memEl = $('#volMem');
    const bus = $('#volBus');
    const busLabel = $('#volBusLabel');
    const dot = $('#volDot');
    const logEl = $('#volLog');
    const countEl = $('#volCount');
    const stateEl = $('#volState');
    const modeEl = $('#volModeTag');
    const toggle = $('#volToggle');
    const runBtn = $('#btnVolRun');
    const isrChip = $('#volIsrChip');
    const isrBtn = $('#btnVolIsr');
    const loopArrow = $('#volLoopArrow');
    const pcEl = $('#volPc');
    const stepBtn = $('#btnVolStep');
    const pauseBtn = $('#btnVolPause');
    const speedInput = $('#volSpeed');
    const speedVal = $('#volSpeedVal');

    let mem = 0;
    let r0 = null;
    let loops = 0;
    let running = false;
    let timer = null;
    let speed = 1;

    const intervalMs = () => 720 / speed;

    function addLog(text, cls) {
      const line = document.createElement('div');
      line.className = 'log-line ' + (cls || '');
      line.innerHTML = text;
      logEl.appendChild(line);
      while (logEl.children.length > 8) logEl.removeChild(logEl.firstChild);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function pulse() {
      if (reduced) return;
      bus.classList.remove('reading');
      void bus.offsetWidth;
      bus.classList.add('reading');
      setTimeout(() => bus.classList.remove('reading'), 700);
    }

    function render() {
      regEl.textContent = r0 === null ? '—' : r0;
      memEl.textContent = mem;
      countEl.textContent = loops;
      bus.classList.toggle('cached', !toggle.checked && running);
      busLabel.textContent = toggle.checked ? '保留每次 LDR' : (running ? '读取被提升：只用 R0' : '读内存');
      modeEl.textContent = toggle.checked ? 'volatile' : '普通变量';
      modeEl.classList.toggle('on', toggle.checked);
    }

    function stop(message, cls) {
      clearInterval(timer);
      timer = null;
      running = false;
      runBtn.textContent = '▶ 播放';
      loopArrow.classList.remove('spin');
      pcEl.classList.remove('hot');
      stateEl.textContent = message || '已停止';
      render();
      if (message) addLog(message, cls);
    }

    function tick() {
      if (toggle.checked) {
        pulse();
        r0 = mem;
        regEl.classList.add('changed');
        setTimeout(() => regEl.classList.remove('changed'), 220);
        addLog('LDR：重新读内存 → R0 = ' + mem, '');
        if (r0 === 1) {
          loops += 1;
          countEl.textContent = loops;
          addLog('条件不成立，退出 while。volatile 生效。', 'good');
          stop('已退出', 'good');
          return;
        }
      } else {
        if (r0 === null) {
          pulse();
          r0 = mem;
          regEl.classList.add('changed');
          setTimeout(() => regEl.classList.remove('changed'), 220);
          addLog('第 1 次：LDR 从内存读 → R0 = ' + mem, '');
        } else {
          addLog('循环判断：直接用缓存的 R0 = ' + r0 + '（没有总线访问）', 'warn');
          if (mem === 1 && r0 === 0) {
            addLog('内存里的 flag 已经是 1，但 CPU 只看 R0 → 永远出不来', 'bad');
          }
        }
        if (r0 === 1) {
          loops += 1;
          countEl.textContent = loops;
          addLog('第 1 次就读到 1，条件不成立，循环退出。', 'good');
          stop('已退出', 'good');
          return;
        }
      }
      loops += 1;
      countEl.textContent = loops;
      render();
    }

    function start() {
      if (running) { stop('已暂停'); return; }
      running = true;
      runBtn.textContent = '■ 暂停';
      loopArrow.classList.add('spin');
      pcEl.classList.add('hot');
      stateEl.textContent = toggle.checked ? 'volatile：保留每次访问' : '无 volatile：读取被提升到循环外';
      if (toggle.checked) {
        addLog('开始：volatile 要求编译器保留这次 LDR，不能把读取提到循环外。', '');
      } else {
        addLog('开始：普通变量允许编译器把 flag 的读取提升到循环外，缓存在 R0。', '');
      }
      tick();
      if (!running) return;   // tick 可能已经读到 1 并退出，不能再挂定时器
      timer = setInterval(tick, intervalMs());
    }

    function pause() {
      if (running) stop('已暂停');
    }

    function step() {
      if (running) stop('已暂停');
      running = true;
      runBtn.textContent = '■ 暂停';
      loopArrow.classList.add('spin');
      pcEl.classList.add('hot');
      stateEl.textContent = '单步：执行一次循环';
      tick();
      if (running) stop('单步完成：已暂停');
    }

    isrBtn.addEventListener('click', () => {
      mem = 1;
      memEl.textContent = '1';
      isrChip.classList.add('fire');
      setTimeout(() => isrChip.classList.remove('fire'), 500);
      addLog('ISR：flag = 1（内存已被改写）', 'warn');
      if (running && !toggle.checked && r0 === 0) {
        addLog('但主循环仍用 R0 = 0，看不到这个变化。', 'bad');
        stateEl.textContent = '已死循环';
      }
      render();
    });

    toggle.addEventListener('change', () => {
      r0 = null;
      addLog(toggle.checked
        ? '已加 volatile：下一次循环必须重新 LDR。'
        : '已去掉 volatile：编译器可以重新把读取提升到循环外。', 'info');
      render();
      if (running) stateEl.textContent = toggle.checked ? 'volatile：保留每次访问' : '无 volatile：读取被提升到循环外';
    });

    runBtn.addEventListener('click', start);
    stepBtn.addEventListener('click', step);
    pauseBtn.addEventListener('click', pause);
    speedInput.addEventListener('input', () => {
      speed = Number(speedInput.value) || 1;
      speedVal.textContent = speed + '×';
      if (running) {
        clearInterval(timer);
        timer = setInterval(tick, intervalMs());
      }
    });

    $('#btnVolReset').addEventListener('click', () => {
      stop();
      mem = 0;
      r0 = null;
      loops = 0;
      memEl.textContent = '0';
      countEl.textContent = '0';
      stateEl.textContent = '未运行';
      logEl.innerHTML = '<div class="log-line dim">已重置。flag = 0，R0 为空。</div>';
      bus.classList.remove('reading', 'cached');
      toggle.checked = false;
      render();
    });

    render();
  })();

  /* =========================================================
     03 · 寄存器指针
     ========================================================= */
  (function pointerLab() {
    const bitsEl = $('#ptrBits');
    if (!bitsEl) return;

    const odrEl = $('#ptrOdr');
    const led = $('#ptrLed');
    const steps = $$('#ptrSteps li');
    const expr = $('#ptrExpr');
    const packet = $('#addrPacket');
    const wire = $('.addr-wire');
    const logEl = $('#ptrLog');
    const runBtn = $('#btnPtrRun');
    const speedInput = $('#ptrSpeed');
    const speedVal = $('#ptrSpeedVal');
    let value = 0;
    let stepIndex = -1;
    let playing = false;
    let timer = null;
    let speed = 1;

    const delay = () => 1000 / speed;

    for (let i = 31; i >= 0; i--) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'bit';
      cell.textContent = '0';
      cell.dataset.bit = String(i);
      cell.title = 'bit ' + i;
      cell.addEventListener('click', () => {
        value = (value ^ (1 << i)) >>> 0;
        render();
        logLine('手动切换 bit ' + i + '：ODR = ' + fmt32(value), 'info');
      });
      bitsEl.appendChild(cell);
    }

    function render() {
      $$('.bit', bitsEl).forEach(cell => {
        const bit = Number(cell.dataset.bit);
        const on = (value >>> bit) & 1;
        cell.setAttribute('aria-label', 'bit ' + bit);
        cell.setAttribute('aria-pressed', String(!!on));
        cell.textContent = on ? '1' : '0';
        cell.classList.toggle('on', !!on);
      });
      odrEl.textContent = fmt32(value);
      led.classList.toggle('on', !!(value & (1 << 5)));
    }

    function setBit(bit) {
      value = (value | (1 << bit)) >>> 0;
      render();
      const cell = $('.bit[data-bit="' + bit + '"]', bitsEl);
      if (cell) {
        cell.classList.remove('flash');
        void cell.offsetWidth;
        cell.classList.add('flash');
      }
      if (bit === 5) led.classList.add('on');
    }

    function logLine(text, cls) {
      logEl.textContent = text;
      logEl.className = 'stage-log' + (cls ? ' ' + cls : '');
    }

    function clearTimer() {
      clearTimeout(timer);
      timer = null;
    }

    function setStep(n) {
      steps.forEach((li, i) => li.classList.toggle('active', i === n));
    }

    function reset() {
      clearTimer();
      playing = false;
      stepIndex = -1;
      value = 0;
      render();
      led.classList.remove('on');
      packet.classList.remove('on');
      wire.classList.remove('flow');
      setStep(-1);
      $$('span', expr).forEach(s => s.classList.remove('lit'));
      logLine('执行后会看到 bit 5 被置 1，PA5 上的 LED 点亮。');
      runBtn.textContent = '▶ 播放';
    }

    function applyStep(n) {
      setStep(n);
      if (n === 0) {
        packet.classList.add('on');
        wire.classList.add('flow');
        logLine('① 0x4001080C 只是一个整数——先当成地址。', 'info');
      } else if (n === 1) {
        const spans = $$('span', expr);
        if (spans[1]) spans[1].classList.add('lit');
        if (spans[2]) spans[2].classList.add('lit');
        logLine('② 强转成 volatile uint32_t *：告诉编译器这是 32 位硬件寄存器。', 'info');
      } else {
        setBit(5);
        logLine('③ 解引用后 |= (1u << 5)：读 → 或 → 写回，bit5 变成 1，PA5 输出高电平。', 'ok');
      }
    }

    function schedule() {
      if (!playing) return;
      if (stepIndex >= 2) {
        playing = false;
        runBtn.textContent = '▶ 播放';
        return;
      }
      timer = setTimeout(() => {
        if (!playing) return;
        stepIndex += 1;
        applyStep(stepIndex);
        if (stepIndex >= 2) {
          playing = false;
          runBtn.textContent = '▶ 播放';
        } else {
          schedule();
        }
      }, delay());
    }

    function play() {
      if (playing) { pause(); return; }
      if (stepIndex >= 2) reset();
      if (stepIndex < 0) {
        stepIndex = 0;
        applyStep(0);
      }
      playing = true;
      runBtn.textContent = '■ 暂停';
      schedule();
    }

    function pause() {
      if (!playing) return;
      playing = false;
      clearTimer();
      runBtn.textContent = '▶ 播放';
    }

    function stepOnce() {
      if (playing) pause();
      if (stepIndex >= 2) return;
      stepIndex += 1;
      applyStep(stepIndex);
    }

    runBtn.addEventListener('click', play);
    $('#btnPtrStep').addEventListener('click', stepOnce);
    $('#btnPtrPause').addEventListener('click', pause);
    $('#btnPtrReset').addEventListener('click', reset);
    speedInput.addEventListener('input', () => {
      speed = Number(speedInput.value) || 1;
      speedVal.textContent = speed + '×';
      if (playing) {
        clearTimer();
        schedule();
      }
    });

    reset();
  })();

  /* =========================================================
     03b · 数组与指针
     ========================================================= */
  (function arrayLab() {
    const cellsEl = $('#arrayCells');
    if (!cellsEl) return;

    const pointer = $('#arrayPointer');
    const labelEl = $('#arrayPointerLabel');
    const logEl = $('#arrayLog');
    const actions = $$('#arrayActions [data-arr]');
    let selected = 'a';

    const addr = i => '0x2000_' + (0x100 + i).toString(16).toUpperCase().padStart(4, '0');

    for (let i = 0; i <= 5; i++) {
      const past = i === 5;
      const cell = document.createElement('div');
      cell.className = 'array-cell' + (past ? ' past' : '');
      cell.dataset.index = String(i);
      cell.innerHTML =
        '<span class="idx">' + (past ? 'a[5]' : 'a[' + i + ']') + '</span>' +
        '<span class="val">' + (past ? '—' : '0x' + (0x11 * (i + 1)).toString(16).toUpperCase().padStart(4, '0')) + '</span>' +
        '<span class="addr">' + addr(i * 2) + '</span>';
      cellsEl.appendChild(cell);
    }

    const choices = {
      a: { index: 0, label: 'a', text: 'a 指向首元素 a[0]：0x2000_0100；类型是 uint16_t *，+1 走 2 字节。' },
      aa: { index: 0, label: '&a', text: '&a 与 a 地址相同，但类型是 uint16_t (*)[5]：+1 会跨过整个数组。' },
      a1: { index: 1, label: 'a + 1', text: 'a + 1 = 0x2000_0102：步长是 sizeof(uint16_t) = 2 字节。' },
      aa1: { index: 5, label: '&a + 1', text: '&a + 1 = 0x2000_010A：步长是 sizeof(a) = 10 字节，指向数组末尾之后。' }
    };

    function place(cell) {
      pointer.style.left = (cell.offsetLeft + cell.offsetWidth / 2) + 'px';
      pointer.classList.add('on');
    }

    function select(key) {
      selected = key;
      const choice = choices[key] || choices.a;
      actions.forEach(btn => btn.classList.toggle('is-on', btn.dataset.arr === key));
      $$('.array-cell', cellsEl).forEach((cell, i) => cell.classList.toggle('hot', i === choice.index));
      labelEl.textContent = choice.label;
      logEl.textContent = choice.text;
      logEl.className = 'stage-log info';
      const cell = $('.array-cell[data-index="' + choice.index + '"]', cellsEl);
      if (cell) place(cell);
    }

    actions.forEach(btn => btn.addEventListener('click', () => select(btn.dataset.arr)));
    select('a');
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => select(selected)).observe(cellsEl);
    }
  })();

  /* =========================================================
     04 · 位操作
     ========================================================= */
  (function bitLab() {
    const cellsEl = $('#bitCells');
    if (!cellsEl) return;

    const ledsEl = $('#bitLeds');
    const binEl = $('#bitBin');
    const hexEl = $('#bitHex');
    const eqEl = $('#bitEquation');
    const nEl = $('#bitN');
    const logEl = $('#bitLog');

    let value = 0;
    let n = 3;

    for (let bit = 7; bit >= 0; bit--) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'bit-cell';
      cell.dataset.bit = String(bit);
      cell.innerHTML = '<span class="idx">bit ' + bit + '</span><span class="val">0</span>';
      cell.setAttribute('aria-label', '位 ' + bit);
      cell.addEventListener('click', () => {
        value ^= (1 << bit);
        n = bit;
        nEl.textContent = n;
        setEquation('reg ^= (1u << ' + n + ');', '点击位格等效于翻转 ^=');
        render('点击 bit ' + n + ' → 翻转，ODR = ' + fmt(value) + (value & (1 << n) ? '（该位为 1）' : '（该位为 0）'), 'info');
      });
      cellsEl.appendChild(cell);

      const lamp = document.createElement('div');
      lamp.className = 'lamp';
      lamp.innerHTML = '<span class="bulb"></span><small>PA' + bit + '</small>';
      ledsEl.appendChild(lamp);
    }

    function setEquation(text, note) {
      eqEl.textContent = text;
      eqEl.classList.remove('pop');
      void eqEl.offsetWidth;
      eqEl.classList.add('pop');
      if (note) logEl.dataset.note = note;
    }

    function render(msg, cls) {
      $$('.bit-cell', cellsEl).forEach(cell => {
        const bit = Number(cell.dataset.bit);
        const on = (value >> bit) & 1;
        cell.classList.toggle('on', !!on);
        cell.classList.toggle('selected', bit === n);
        $('.val', cell).textContent = on ? '1' : '0';
      });
      $$('.lamp', ledsEl).forEach((lamp, idx) => {
        const bit = 7 - idx;
        lamp.classList.toggle('on', !!((value >> bit) & 1));
      });
      binEl.textContent = '0b' + value.toString(2).padStart(8, '0').replace(/(.{4})/, '$1 ');
      hexEl.textContent = fmt(value);
      nEl.textContent = n;
      if (msg) {
        logEl.textContent = msg;
        logEl.className = 'stage-log' + (cls ? ' ' + cls : '');
      }
    }

    $('#btnBitSet').addEventListener('click', () => {
      const before = value;
      value |= (1 << n);
      setEquation('reg |= (1u << ' + n + ');');
      render('置位 bit ' + n + '：' + fmt(before) + ' → ' + fmt(value) + '，其它位不变。', 'ok');
    });

    $('#btnBitClear').addEventListener('click', () => {
      const before = value;
      value &= ~(1 << n);
      setEquation('reg &= ~(1u << ' + n + ');');
      render('清位 bit ' + n + '：' + fmt(before) + ' → ' + fmt(value) + '，只把目标位清 0。', 'ok');
    });

    $('#btnBitToggle').addEventListener('click', () => {
      const before = value;
      value ^= (1 << n);
      setEquation('reg ^= (1u << ' + n + ');');
      render('翻转 bit ' + n + '：' + fmt(before) + ' → ' + fmt(value) + '。', 'ok');
    });

    $('#btnBitRandom').addEventListener('click', () => {
      value = Math.floor(Math.random() * 256);
      setEquation('reg = ' + fmt(value) + ';  /* 随机图案 */');
      render('随机图案：' + fmt(value) + '，可以对照二进制看每一位。', 'info');
    });

    $('#btnBitReset').addEventListener('click', () => {
      value = 0;
      setEquation('reg = 0x00;');
      render('寄存器清零。', 'info');
    });

    render();
    setEquation('reg |= (1u << 3);');
  })();

  /* =========================================================
     04b · BSRR 单次写
     ========================================================= */
  (function bsrrLab() {
    const writeEl = $('#bsrrWrite');
    if (!writeEl) return;

    const odrEl = $('#bsrrOdr');
    const logEl = $('#bsrrLog');
    let odr = 0;
    let lastWrite = 0;

    function paint(msg, cls) {
      writeEl.textContent = 'BSRR = ' + fmt32(lastWrite);
      odrEl.textContent = 'ODR = ' + fmt32(odr);
      if (msg) {
        logEl.textContent = msg;
        logEl.className = 'stage-log ' + (cls || 'info');
      }
    }

    $('#btnBsrrSet').addEventListener('click', () => {
      lastWrite = (1 << 5) >>> 0;
      odr = (odr | (1 << 5)) >>> 0;
      paint('低 16 位写 1：单次写 BSRR 置位 PA5，不需要先读 ODR。', 'good');
    });

    $('#btnBsrrReset').addEventListener('click', () => {
      lastWrite = (1 << 21) >>> 0;   // 高 16 位的 bit5
      odr = (odr & ~(1 << 5)) >>> 0;
      paint('高 16 位写 1：单次写 BSRR 复位 PA5，同样是一次总线写。', 'good');
    });

    paint();
  })();

  /* =========================================================
     05 · 结构体对齐
     ========================================================= */
  (function alignLab() {
    const grid = $('#alignGrid');
    if (!grid) return;

    const sizeEl = $('#alignSize');
    const logEl = $('#alignLog');
    const declEl = $('.struct-decl');
    const bodyEl = $('.struct-body');
    const btnDefault = $('#btnAlignDefault');
    const btnPacked = $('#btnAlignPacked');
    const btnReorder = $('#btnAlignReorder');

    const LAYOUTS = {
      normal: {
        size: 12,
        decl: 'struct Sample',
        body: 'uint8_t a; uint32_t b; uint16_t c;',
        cells: [
          { o: 0, k: 'a' }, { o: 1, p: 1 }, { o: 2, p: 1 }, { o: 3, p: 1 },
          { o: 4, k: 'b' }, { o: 5, k: 'b' }, { o: 6, k: 'b' }, { o: 7, k: 'b' },
          { o: 8, k: 'c' }, { o: 9, k: 'c' }, { o: 10, p: 1 }, { o: 11, p: 1, tail: true }
        ],
        log: '默认布局：a 后面补 3 B，c 后面补 2 B，总共 12 B。'
      },
      packed: {
        size: 7,
        decl: 'struct Sample __attribute__((packed))',
        body: 'uint8_t a; uint32_t b; uint16_t c;',
        cells: [
          { o: 0, k: 'a' },
          { o: 1, k: 'b' }, { o: 2, k: 'b' }, { o: 3, k: 'b' }, { o: 4, k: 'b' },
          { o: 5, k: 'c' }, { o: 6, k: 'c' }
        ],
        log: 'packed：填充全去掉，1 + 4 + 2 = 7 B；但 b 落在奇数地址，非对齐访问可能 fault 或变慢。'
      },
      reorder: {
        size: 8,
        decl: 'struct Sample  /* 成员重排 */',
        body: 'uint32_t b; uint16_t c; uint8_t a;',
        cells: [
          { o: 0, k: 'b' }, { o: 1, k: 'b' }, { o: 2, k: 'b' }, { o: 3, k: 'b' },
          { o: 4, k: 'c' }, { o: 5, k: 'c' },
          { o: 6, k: 'a' }, { o: 7, p: 1, tail: true }
        ],
        log: '按 4 → 2 → 1 重排：4 + 2 + 1 + 1 尾部填充 = 8 B，比默认省 4 B。'
      }
    };

    function render(kind) {
      const layout = LAYOUTS[kind];
      grid.innerHTML = '';
      layout.cells.forEach((cell, i) => {
        const el = document.createElement('div');
        el.className = 'cell ' + (cell.p ? 'pad' : cell.k);
        if (cell.tail) el.classList.add('tail');
        el.style.animationDelay = (i * 16) + 'ms';
        if (cell.p) {
          el.innerHTML = '<span class="off">' + (cell.o !== undefined ? cell.o : '') + '</span><b>pad</b><small>填充</small>';
          if (cell.o !== undefined) $('.off', el).textContent = cell.o;
        } else {
          el.innerHTML = '<span class="off">' + cell.o + '</span><b>' + cell.k + '</b><small>' + (cell.k === 'a' ? '1 B' : cell.k === 'b' ? '4 B' : '2 B') + '</small>';
        }
        grid.appendChild(el);
      });
      sizeEl.textContent = layout.size;
      sizeEl.style.color = kind === 'packed' ? 'var(--orange)' : 'var(--cyan)';
      declEl.textContent = layout.decl;
      bodyEl.textContent = layout.body;
      logEl.textContent = layout.log;
      logEl.className = 'stage-log ' + (kind === 'packed' ? 'info' : 'ok');
      btnDefault.classList.toggle('is-on', kind === 'normal');
      btnPacked.classList.toggle('is-on', kind === 'packed');
      btnReorder.classList.toggle('is-on', kind === 'reorder');
    }

    btnDefault.addEventListener('click', () => render('normal'));
    btnPacked.addEventListener('click', () => render('packed'));
    btnReorder.addEventListener('click', () => render('reorder'));

    render('normal');
  })();

  /* =========================================================
     06 · 大小端
     ========================================================= */
  (function endianLab() {
    const grid = $('#endianGrid');
    if (!grid) return;

    const p0El = $('#endianP0');
    const hintEl = $('#endianHint');
    const logEl = $('#endianLog');
    const btnLE = $('#btnLE');
    const btnBE = $('#btnBE');
    const btnSwap = $('#btnEndianSwap');
    const ubSigned = $('#ubSigned');
    const ubSignedNote = $('#ubSignedNote');
    const ubUnsigned = $('#ubUnsigned');
    const ubLog = $('#endianUbLog');
    const btn7F = $('#btnEndian7F');
    const btn80 = $('#btnEndian80');

    let little = true;
    let value = 0x12345678;
    const valueEl = $('#endianValue');

    function render() {
      const bytes = [24, 16, 8, 0].map(shift => (value >>> shift) & 0xFF);
      if (little) bytes.reverse();
      valueEl.textContent = fmt(value, 8);
      const roles = little
        ? ['byte0 · LSB', 'byte1', 'byte2', 'byte3 · MSB']
        : ['byte0 · MSB', 'byte1', 'byte2', 'byte3 · LSB'];

      grid.innerHTML = '';
      bytes.forEach((byte, i) => {
        const el = document.createElement('div');
        el.className = 'eb' + (roles[i].includes('LSB') ? ' lsb' : roles[i].includes('MSB') ? ' msb' : '');
        el.style.animationDelay = (i * 55) + 'ms';
        el.innerHTML = '<span class="byte">' + fmt(byte) + '</span><span class="role">' + roles[i] + '</span>';
        grid.appendChild(el);
      });

      p0El.textContent = fmt(bytes[0]);
      hintEl.textContent = little ? '（最低有效字节）' : '（最高有效字节）';
      logEl.textContent = (little ? '小端：低地址存低位字节' : '大端：低地址存高位字节') +
        '。x = ' + fmt(value, 8) + '，p[0] = ' + fmt(bytes[0]) + '。';
      logEl.className = 'stage-log info';
      btnLE.classList.toggle('is-on', little);
      btnBE.classList.toggle('is-on', !little);
    }

    btnLE.addEventListener('click', () => { little = true; render(); });
    btnBE.addEventListener('click', () => { little = false; render(); });
    btnSwap.addEventListener('click', () => {
      const before = value;
      value = ((value >>> 24) | ((value >>> 8) & 0x0000FF00) |
        ((value << 8) & 0x00FF0000) | (value << 24)) >>> 0;
      render();
      logEl.textContent = '交换 x 的四个字节：' + fmt(before, 8) + ' → ' + fmt(value, 8) +
        '；仍按' + (little ? '小端' : '大端') + '存储。再次点击可恢复原值。';
      logEl.className = 'stage-log ok';
    });

    let firstByte = 0x7F;

    function renderUb() {
      const shifted = (firstByte << 24) >>> 0;
      ubUnsigned.textContent = fmt32(shifted);
      if (firstByte === 0x80) {
        ubSigned.textContent = 'UB';
        ubSignedNote.textContent = '有符号左移进入符号位，结果不可依赖';
        ubLog.textContent = 'buf[0] = 0x80 时，buf[0] << 24 在 32 位 int 上可能溢出（UB）；先转 uint32_t 再移位，结果才是明确的 0x8000_0000。';
        ubLog.className = 'stage-log bad';
      } else {
        ubSigned.textContent = fmt32(shifted);
        ubSignedNote.textContent = '最高位为 0，暂时没溢出';
        ubLog.textContent = '0x7F 的最高位是 0，左移 24 位仍是正数；换成 0x80 就会进入符号位。';
        ubLog.className = 'stage-log info';
      }
      btn7F.classList.toggle('is-on', firstByte === 0x7F);
      btn80.classList.toggle('is-on', firstByte === 0x80);
    }

    btn7F.addEventListener('click', () => { firstByte = 0x7F; renderUb(); });
    btn80.addEventListener('click', () => { firstByte = 0x80; renderUb(); });

    render();
    renderUb();
  })();

  /* =========================================================
     07 · 中断与原子性
     ========================================================= */
  (function interruptLab() {
    const stepsEl = $('#isrSteps');
    if (!stepsEl) return;

    const r0El = $('#isrR0');
    const memEl = $('#isrMem');
    const verdictEl = $('#isrVerdict');
    const atomicEl = $('#isrAtomic');
    const playBtn = $('#btnIsrPlay');
    const prevBtn = $('#btnIsrPrev');
    const nextBtn = $('#btnIsrNext');
    const speedInput = $('#isrSpeed');
    const speedVal = $('#isrSpeedVal');

    let index = -1;
    let steps = [];
    let timer = null;
    let speed = 1;

    const intervalMs = () => 850 / speed;

    const normalSteps = [
      { lane: 'main', asm: 'LDR r0, [count]', note: '主循环读到 5', r0: '5', mem: '5' },
      { lane: 'isr', asm: '中断到来 → 硬件保存 r0=5', note: '现场压栈，r0 暂时不用', r0: '5', mem: '5' },
      { lane: 'isr', asm: 'LDR r0, [count]', note: 'ISR 也读到 5', r0: '5', mem: '5' },
      { lane: 'isr', asm: 'ADD r0, r0, #1', note: 'r0 = 6', r0: '6', mem: '5' },
      { lane: 'isr', asm: 'STR r0, [count]', note: '写回 6', r0: '6', mem: '6' },
      { lane: 'isr', asm: '返回 → 恢复 r0=5', note: '主循环的现场回来了', r0: '5', mem: '6' },
      { lane: 'main', asm: 'ADD r0, r0, #1', note: 'r0 = 6（还以为 count 是 5）', r0: '6', mem: '6' },
      { lane: 'main', asm: 'STR r0, [count]', note: '又写回 6：一次自增丢了', r0: '6', mem: '6' }
    ];

    const atomicSteps = [
      { lane: 'main', asm: 'MRS r1, PRIMASK', note: '保存原中断屏蔽状态（这里为 0）', r0: '—', mem: '5' },
      { lane: 'main', asm: 'CPSID i', note: '关中断，进入临界区', r0: '—', mem: '5' },
      { lane: 'main', asm: 'LDR r0, [count]', note: '主循环读到 5', r0: '5', mem: '5' },
      { lane: 'main', asm: 'ADD r0, r0, #1', note: 'r0 = 6', r0: '6', mem: '5' },
      { lane: 'main', asm: 'STR r0, [count]', note: '写回 6', r0: '6', mem: '6' },
      { lane: 'main', asm: 'MSR PRIMASK, r1', note: '恢复原状态：不是无条件开中断', r0: '6', mem: '6' },
      { lane: 'isr', asm: 'LDR r0, [count]', note: 'ISR 现在读到 6', r0: '6', mem: '6' },
      { lane: 'isr', asm: 'ADD r0, r0, #1', note: 'r0 = 7', r0: '7', mem: '6' },
      { lane: 'isr', asm: 'STR r0, [count]', note: '写回 7：两次都生效', r0: '7', mem: '7' }
    ];

    function build() {
      clearInterval(timer);
      timer = null;
      playBtn.textContent = '▶ 播放';
      steps = atomicEl.checked ? atomicSteps : normalSteps;
      stepsEl.innerHTML = '';
      steps.forEach((step, i) => {
        const el = document.createElement('div');
        el.className = 'step';
        el.dataset.lane = step.lane;
        el.dataset.index = String(i);
        el.innerHTML =
          '<span class="lane">' + (step.lane === 'main' ? 'MAIN' : 'ISR') + '</span>' +
          '<span class="asm">' + step.asm + '<br><s>' + step.note + '</s></span>' +
          '<span class="state">r0=' + step.r0 + ' count=' + step.mem + '</span>';
        stepsEl.appendChild(el);
      });
      index = -1;
      render();
      verdictEl.className = 'isr-verdict';
      verdictEl.innerHTML = '<span class="verdict-icon">?</span><span>' +
        (atomicEl.checked
          ? '读—改—写都在临界区内，走完 ' + steps.length + ' 步看看 count。'
          : '按「单步」或「播放」走完整个交错过程，看看 count 最后是多少。') +
        '</span>';
    }

    function render() {
      const current = index >= 0 ? steps[index] : null;
      r0El.textContent = current ? current.r0 : '—';
      memEl.textContent = current ? current.mem : '5';
      $$('.step', stepsEl).forEach((el, i) => {
        el.classList.toggle('active', i === index);
        el.classList.toggle('done', i < index);
      });
      if (index >= 0) {
        const active = $('.step[data-index="' + index + '"]', stepsEl);
        if (active) {
          const top = active.offsetTop - 90;
          stepsEl.scrollTo({ top: Math.max(0, top), behavior: reduced ? 'auto' : 'smooth' });
        }
      }
    }

    function finish() {
      clearInterval(timer);
      timer = null;
      playBtn.textContent = '▶ 播放';
      const atomic = atomicEl.checked;
      verdictEl.className = 'isr-verdict ' + (atomic ? 'good' : 'bad');
      verdictEl.innerHTML = '<span class="verdict-icon">' + (atomic ? '✓' : '!') + '</span><span>' +
        (atomic
          ? 'count = 7。两次自增都生效；读—改—写全在临界区内，退出时恢复原 PRIMASK，而不是无条件开中断。'
          : 'count = 6，不是 7。ISR 和主循环都基于“5”计算，最后一次写覆盖了另一次：丢失更新。') +
        '</span>';
    }

    function next() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        playBtn.textContent = '▶ 播放';
      }
      if (index >= steps.length - 1) { finish(); return; }
      index += 1;
      render();
      if (index === steps.length - 1) finish();
    }

    function prev() {
      clearInterval(timer);
      timer = null;
      playBtn.textContent = '▶ 播放';
      if (index >= 0) {
        index -= 1;
        render();
        verdictEl.className = 'isr-verdict';
        verdictEl.innerHTML = '<span class="verdict-icon">…</span><span>已回退一步，继续单步或播放。</span>';
      }
    }

    function stopPlayback() {
      clearInterval(timer);
      timer = null;
      playBtn.textContent = '▶ 播放';
    }

    function startPlayback() {
      clearInterval(timer);
      if (index >= steps.length - 1) {
        index = -1;
        render();
      }
      playBtn.textContent = '■ 暂停';
      timer = setInterval(() => {
        if (index >= steps.length - 1) {
          stopPlayback();
          finish();
          return;
        }
        index += 1;
        render();
        if (index === steps.length - 1) {
          stopPlayback();
          finish();
        }
      }, intervalMs());
    }

    playBtn.addEventListener('click', () => {
      if (timer) {
        stopPlayback();
        return;
      }
      startPlayback();
    });

    $('#btnIsrPause').addEventListener('click', stopPlayback);
    speedInput.addEventListener('input', () => {
      speed = Number(speedInput.value) || 1;
      speedVal.textContent = speed + '×';
      if (timer) startPlayback();
    });

    nextBtn.addEventListener('click', next);
    prevBtn.addEventListener('click', prev);
    atomicEl.addEventListener('change', build);
    $('#btnIsrReset').addEventListener('click', () => {
      clearInterval(timer);
      timer = null;
      playBtn.textContent = '▶ 播放';
      build();
    });

    build();
  })();

  /* =========================================================
     08 · const 与指针
     ========================================================= */
  (function constLab() {
    const grid = $('#constGrid');
    if (!grid) return;

    $$('.const-card', grid).forEach(card => {
      const kind = card.dataset.kind;
      const result = $('.const-result', card);
      const canWrite = kind === 'ptr';
      const canPoint = kind === 'data';

      function tryChange(type) {
        let ok, message;
        if (type === 'write') {
          ok = canWrite;
          message = ok
            ? "✓ 通过：*p = 'x';  数据可写，改的是 0x2000 那块内存。"
            : '✗ 编译错误：assignment of read-only location *p';
        } else {
          ok = canPoint;
          message = ok
            ? '✓ 通过：p = q;  只是让指针指向别处，数据没动。'
            : '✗ 编译错误：assignment of read-only variable p';
        }
        result.textContent = message;
        result.className = 'const-result ' + (ok ? 'ok' : 'err');
        if (!ok) {
          card.classList.remove('shake');
          void card.offsetWidth;
          card.classList.add('shake');
        }
      }

      $$('[data-try]', card).forEach(btn => {
        btn.addEventListener('click', () => tryChange(btn.dataset.try));
      });
    });
  })();

  /* =========================================================
     09 · 整数陷阱
     ========================================================= */
  (function integerLab() {
    const counterEl = $('#intCounter');
    if (!counterEl) return;

    const loopsEl = $('#intLoops');
    const barEl = $('#intBar');
    const verdictEl = $('#intVerdict');
    const runBtn = $('#btnIntRun');
    const condEl = $('#intCond');

    let value = 0;
    let total = 0;
    let wraps = 0;
    let timer = null;

    function render() {
      counterEl.textContent = value;
      counterEl.classList.toggle('wrap', wraps > 0);
      loopsEl.textContent = total;
      barEl.style.width = (value / 255 * 100) + '%';
      barEl.classList.toggle('hot', wraps > 0);
    }

    function reset() {
      clearInterval(timer);
      timer = null;
      value = 0;
      total = 0;
      wraps = 0;
      runBtn.disabled = false;
      runBtn.textContent = '▶ 运行这个 for';
      verdictEl.className = 'int-verdict';
      verdictEl.textContent = '点「运行」看 i 走到 255 之后发生了什么。';
      condEl.textContent = '永远成立';
      render();
    }

    runBtn.addEventListener('click', () => {
      if (timer) return;
      value = 0;
      total = 0;
      wraps = 0;
      verdictEl.className = 'int-verdict';
      verdictEl.textContent = 'i 正在增加……';
      runBtn.disabled = true;
      runBtn.textContent = '运行中…';
      timer = setInterval(() => {
        value += 1;
        total += 1;
        if (value > 255) {
          value = 0;
          wraps += 1;
          if (wraps === 1) {
            verdictEl.className = 'int-verdict bad';
            verdictEl.textContent = '注意：i 从 255 回绕到了 0，但 0 < 256 仍然成立 → 循环继续。';
          }
          if (wraps >= 2) {
            clearInterval(timer);
            timer = null;
            runBtn.disabled = false;
            runBtn.textContent = '▶ 再运行一次';
            verdictEl.className = 'int-verdict bad';
            verdictEl.textContent = '死循环确认：uint8_t 永远小于 256。已经跑了 ' + total + ' 次，i 仍会回到 0。';
          }
        }
        render();
      }, 5);
    });

    $('#btnIntReset').addEventListener('click', reset);

    render();
  })();

  /* =========================================================
     10 · 启动流程 + 栈
     ========================================================= */
  (function startupLab() {
    const flow = $('#bootFlow');
    const framesEl = $('#stackFrames10');
    if (!flow || !framesEl) return;

    const depthEl = $('#stackDepth');
    const spEl = $('#stackSP');
    const warnEl = $('#stackWarn');
    const freeEl = $('#stackFreeLabel');
    const meter = $('.stack-meter');
    const pointer = $('#stackPointer');
    const bootLog = $('#bootLog');

    // 启动流程依次点亮
    if ('IntersectionObserver' in window) {
      let played = false;
      const io = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting || played) return;
          played = true;
          $$('li', flow).forEach((li, i) => {
            setTimeout(() => li.classList.add('on'), i * 380);
          });
        });
      }, { threshold: 0.35 });
      io.observe(flow);
    } else {
      $$('li', flow).forEach(li => li.classList.add('on'));
    }

    const STACK_TOP = 0x5000;
    const STACK_BYTES = 512;
    const FRAME_BYTES = 40;

    function update() {
      const depth = Number(depthEl.value);
      framesEl.innerHTML = '';
      for (let i = 0; i < depth; i++) {
        const frame = document.createElement('div');
        frame.className = 'sf';
        const isLast = i === depth - 1;
        frame.innerHTML = '<span>' + (isLast && depth >= 13 ? 'buf[40]' : 'frame_' + (i + 1)) + '</span><span>' + FRAME_BYTES + ' B</span>';
        framesEl.appendChild(frame);
      }

      const used = depth * FRAME_BYTES;
      const free = Math.max(0, STACK_BYTES - used);
      const sp = STACK_TOP - used;

      spEl.textContent = 'SP = 0x2000_' + sp.toString(16).toUpperCase().padStart(4, '0');
      freeEl.textContent = free + ' B';

      const hard = depth >= 13;
      const warn = depth >= 11;

      warnEl.className = hard ? 'bad' : warn ? 'warn' : 'ok';
      warnEl.textContent = hard
        ? '栈越界：可能破坏相邻数据'
        : warn
          ? '接近栈底，注意大数组'
          : '栈空间充足';

      meter.classList.toggle('danger', warn && !hard);
      meter.classList.toggle('hardfault', hard);

      // SP 指针定位在栈帧顶部
      pointer.style.top = (framesEl.offsetTop - 8) + 'px';
      pointer.style.color = hard ? 'var(--red)' : 'var(--purple)';

      if (hard) {
        bootLog.textContent = 'SP = 0x2000_' + sp.toString(16).toUpperCase().padStart(4, '0') + ' 已越过示例栈底，可能破坏相邻数据；不一定立即触发 HardFault，不能依赖异常来发现溢出。';
        bootLog.className = 'stage-log bad';
      } else if (warn) {
        bootLog.textContent = '只剩 ' + free + ' B 栈空间。下一层调用或一次 sprintf 就可能越界。';
        bootLog.className = 'stage-log info';
      } else {
        bootLog.textContent = '启动代码跑完，C 语言才有“已初始化的全局变量”和“全 0 的 .bss”可用。';
        bootLog.className = 'stage-log';
      }
    }

    depthEl.addEventListener('input', update);
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => { pointer.style.top = (framesEl.offsetTop - 8) + 'px'; }).observe(meter);
    }
    update();
  })();

  /* =========================================================
     11 · 宏展开
     ========================================================= */
  (function macroLab() {
    const traceEl = $('#macroTrace');
    if (!traceEl) return;

    const callEl = $('#macroCall');
    const verdictEl = $('#macroVerdict');
    const varsEl = $('#macroVars');
    const runBtn = $('#btnMacroRun');
    const stepBtn = $('#btnMacroStep');
    const pauseBtn = $('#btnMacroPause');
    const resetBtn = $('#btnMacroReset');
    const speedInput = $('#macroSpeed');
    const speedVal = $('#macroSpeedVal');
    const btnBad = $('#btnMacroBad');
    const btnGood = $('#btnMacroGood');
    const argBtns = {
      expr: $('#btnArgExpr'),
      inc: $('#btnArgInc'),
      const: $('#btnArgConst')
    };
    const doWhileEl = $('#macroDoWhileCode');
    const doWhileLog = $('#macroDoWhileLog');
    const doWhileToggle = $('#macroDoWhile');

    const A = 2;
    const ARG_TEXT = { expr: 'a + 1', inc: 'n++', const: '2 + 3' };
    let safe = false;
    let argKey = 'expr';
    let n = 3;
    let plan = { rows: [], verdict: '', cls: '' };
    let planIndex = -1;
    let playTimer = null;
    let speed = 1;

    const row = (step, code, tag, cls) => ({ step, code, tag, cls });

    function setOn(btn, on) {
      if (btn) btn.classList.toggle('is-on', on);
    }

    function updateVars() {
      varsEl.textContent = 'a = ' + A + ' · n = ' + n;
    }

    function renderCall() {
      callEl.textContent = 'SQ(' + ARG_TEXT[argKey] + ')';
      updateVars();
    }

    function buildPlan() {
      if (argKey === 'inc') {
        const body = safe ? '((n++) * (n++))' : 'n++ * n++';
        return {
          rows: [
            row('替换', 'SQ(n++) → ' + body, '同一实参展开两次', 'warn'),
            row('检查', '两个 n++ 之间没有顺序点：未定义行为', 'UB', 'bad'),
            row('结论', '不要猜测结果（6、9、10…都可能）；动画停在这里', '不作保证', 'bad')
          ],
          verdict: '参数在宏体里出现两次，就被求值两次；两个修改未排序，属于 UB。不要把 n++、函数调用等有副作用的表达式传给宏。',
          cls: 'bad'
        };
      }

      let expanded;
      let evalText;
      let value;
      let expected;
      let why;

      if (argKey === 'expr') {
        expanded = safe ? '((a + 1) * (a + 1))' : 'a + 1 * a + 1';
        evalText = safe ? '((2 + 1) * (2 + 1)) = 3 * 3 = 9' : '2 + 1 * 2 + 1 = 5';
        value = safe ? 9 : 5;
        expected = 9;
        why = safe ? '先算括号，优先级正确' : '乘法先于加法，括号丢了';
      } else {
        expanded = safe ? '((2 + 3) * (2 + 3))' : '2 + 3 * 2 + 3';
        evalText = safe ? '((2 + 3) * (2 + 3)) = 5 * 5 = 25' : '2 + 3 * 2 + 3 = 11';
        value = safe ? 25 : 11;
        expected = 25;
        why = safe ? '先算括号，优先级正确' : '乘法先于加法，括号丢了';
      }

      return {
        rows: [
          row('替换', 'SQ(' + ARG_TEXT[argKey] + ') → ' + expanded,
            safe ? '括号完整' : '括号缺失', safe ? 'good' : 'bad'),
          row('求值', evalText, why, safe ? 'good' : 'bad'),
          row('目标', '期望 = ' + expected + ' · 实际 = ' + value,
            value === expected ? '一致' : '不一致', value === expected ? 'good' : 'bad')
        ],
        verdict: value === expected
          ? '括号把参数和整体都保护住了，展开后的求值顺序与预期一致。注意：括号解决不了副作用。'
          : '展开后运算符优先级变了：' + value + ' ≠ ' + expected + '。宏体里每个参数、整个表达式都要加括号。',
        cls: value === expected ? 'good' : 'bad'
      };
    }

    function pause() {
      if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
      }
      runBtn.textContent = '▶ 播放';
    }

    function prepare() {
      pause();
      n = 3;
      updateVars();
      plan = buildPlan();
      planIndex = -1;
      traceEl.innerHTML = '';
      verdictEl.className = 'macro-verdict';
      verdictEl.textContent = '点「播放」或「单步」开始展开。';
    }

    function renderRow() {
      const item = plan.rows[planIndex];
      const el = document.createElement('div');
      el.className = 'trace-row ' + (item.cls || '');
      el.innerHTML = '<span class="step">' + item.step + '</span><code>' + item.code + '</code>' +
        (item.tag ? '<span class="tag">' + item.tag + '</span>' : '');
      traceEl.appendChild(el);
    }

    function finalize() {
      verdictEl.textContent = plan.verdict;
      verdictEl.className = 'macro-verdict ' + plan.cls;
    }

    function stepOnce() {
      if (playTimer) pause();
      if (planIndex >= plan.rows.length - 1) {
        finalize();
        return;
      }
      planIndex += 1;
      renderRow();
      if (planIndex === plan.rows.length - 1) finalize();
    }

    function play() {
      if (playTimer) {
        pause();
        return;
      }
      if (planIndex >= plan.rows.length - 1) {
        traceEl.innerHTML = '';
        planIndex = -1;
        verdictEl.className = 'macro-verdict';
        verdictEl.textContent = '重新展开…';
      }
      if (planIndex < 0) stepOnce();
      if (planIndex >= plan.rows.length - 1) return;
      runBtn.textContent = '■ 暂停';
      playTimer = setInterval(() => {
        if (planIndex >= plan.rows.length - 1) {
          pause();
          return;
        }
        planIndex += 1;
        renderRow();
        if (planIndex === plan.rows.length - 1) {
          pause();
          finalize();
        }
      }, 520 / speed);
    }

    function selectMacro(isSafe) {
      safe = isSafe;
      setOn(btnBad, !safe);
      setOn(btnGood, safe);
      prepare();
      play();
    }

    function selectArg(key) {
      argKey = key;
      Object.keys(argBtns).forEach(k => setOn(argBtns[k], k === key));
      renderCall();
      prepare();
      play();
    }

    function renderDoWhile() {
      const on = doWhileToggle.checked;
      if (on) {
        const lines = [
          '<span class="tok-k">#define</span> LOG(msg) <span class="tok-k">do</span> { \\',
          '    <span class="tok-f">printf</span>(<span class="tok-s">"[%s] "</span>, TAG); \\',
          '    <span class="tok-f">printf</span>(<span class="tok-s">"%s\\n"</span>, msg); \\',
          '} <span class="tok-k">while</span> (<span class="tok-n">0</span>)',
          '',
          '<span class="tok-k">if</span> (ok)',
          '    LOG(<span class="tok-s">"hi"</span>);',
          '<span class="tok-k">else</span>',
          '    <span class="tok-f">puts</span>(<span class="tok-s">"no"</span>);   <span class="tok-c">// 整段是一条语句</span>'
        ];
        doWhileEl.innerHTML = '<code>' + lines.join('\n') + '</code>';
        doWhileLog.className = 'stage-log good';
        doWhileLog.textContent = 'do { } while (0) 把两条 printf 包成一条语句，if/else 不会被拆散。';
      } else {
        const lines = [
          '<span class="tok-k">#define</span> LOG(msg) \\',
          '    <span class="tok-f">printf</span>(<span class="tok-s">"[%s] "</span>, TAG); \\',
          '    <span class="tok-f">printf</span>(<span class="tok-s">"%s\\n"</span>, msg)',
          '',
          '<span class="tok-k">if</span> (ok)',
          '    LOG(<span class="tok-s">"hi"</span>);',
          '<span class="tok-k">else</span>',
          '    <span class="tok-f">puts</span>(<span class="tok-s">"no"</span>);',
          '',
          '<span class="tok-c">/* 展开后 */</span>',
          '<span class="tok-k">if</span> (ok)',
          '    <span class="tok-f">printf</span>(<span class="tok-s">"[%s] "</span>, TAG);',
          '<span class="tok-f">printf</span>(<span class="tok-s">"%s\\n"</span>, <span class="tok-s">"hi"</span>);',
          '<span class="macro-err">else</span>   <span class="tok-c">// 悬空：语法错误</span>',
          '    <span class="tok-f">puts</span>(<span class="tok-s">"no"</span>);'
        ];
        doWhileEl.innerHTML = '<code>' + lines.join('\n') + '</code>';
        doWhileLog.className = 'stage-log bad';
        doWhileLog.textContent = '宏体里的两条语句只有第一条被 if 管住，else 悬空 → 语法错误。';
      }
    }

    btnBad.addEventListener('click', () => selectMacro(false));
    btnGood.addEventListener('click', () => selectMacro(true));
    $('#btnArgExpr').addEventListener('click', () => selectArg('expr'));
    $('#btnArgInc').addEventListener('click', () => selectArg('inc'));
    $('#btnArgConst').addEventListener('click', () => selectArg('const'));
    runBtn.addEventListener('click', play);
    stepBtn.addEventListener('click', stepOnce);
    pauseBtn.addEventListener('click', pause);
    speedInput.addEventListener('input', () => {
      speed = Number(speedInput.value) || 1;
      speedVal.textContent = speed + '×';
      if (playTimer) {
        pause();
        play();
      }
    });
    doWhileToggle.addEventListener('change', renderDoWhile);

    resetBtn.addEventListener('click', () => {
      pause();
      safe = false;
      argKey = 'expr';
      n = 3;
      setOn(btnBad, true);
      setOn(btnGood, false);
      Object.keys(argBtns).forEach(k => setOn(argBtns[k], k === 'expr'));
      renderCall();
      prepare();
      verdictEl.textContent = '选一种定义和参数，点「播放」或「单步」。';
      doWhileToggle.checked = false;
      renderDoWhile();
    });

    renderCall();
    renderDoWhile();
    setOn(btnBad, true);
    setOn(btnGood, false);
    Object.keys(argBtns).forEach(k => setOn(argBtns[k], k === 'expr'));
    prepare();
  })();

  /* =========================================================
     12 · 预处理器工具箱
     ========================================================= */
  (function preprocessorLab() {
    const debugToggle = $('#ppDebug');
    if (!debugToggle) return;

    const debugVal = $('#ppDebugVal');
    const debugLabel = $('#ppDebugLabel');
    const ppOutput = $('#ppOutput');
    const ppLog = $('#ppCondLog');

    function renderDebug() {
      const on = debugToggle.checked;
      debugVal.textContent = on ? '1' : '0';
      debugLabel.textContent = 'DEBUG = ' + (on ? '1' : '0');
      if (on) {
        ppOutput.innerHTML = '<code><span class="tok-t">void</span> <span class="tok-f">report</span>(<span class="tok-t">int</span> x) {\n' +
          '    <span class="kept">printf("x = %d\\n", x);</span>\n' +
          '}</code>';
        ppLog.textContent = 'DEBUG=1：printf 被保留，进入编译。';
        ppLog.className = 'stage-log good';
      } else {
        ppOutput.innerHTML = '<code><span class="tok-t">void</span> <span class="tok-f">report</span>(<span class="tok-t">int</span> x) {\n' +
          '    <span class="removed">/* printf 被预处理器删除 */</span>\n' +
          '    (void)0;\n' +
          '}</code>';
        ppLog.textContent = 'DEBUG=0：#if 块整段消失，编译器根本看不到 printf。';
        ppLog.className = 'stage-log info';
      }
    }

    const tokenStage = $('#tokenStage');
    const tokenLog = $('#tokenLog');
    const tokenBtns = {
      stringify: $('#btnStringify'),
      concat: $('#btnConcat'),
      line: $('#btnLine')
    };

    function selectToken(kind) {
      Object.keys(tokenBtns).forEach(k => tokenBtns[k].classList.toggle('is-on', k === kind));

      if (kind === 'stringify') {
        tokenStage.innerHTML =
          '<div class="token-line">' +
            '<span class="token-chip src">GPIOA</span>' +
            '<span class="token-op">#</span>' +
            '<span class="token-chip str">"GPIOA"</span>' +
          '</div>' +
          '<div class="token-note"># 把紧随的参数原样变成字符串字面量。</div>';
        tokenLog.textContent = '字符串化常用于把枚举名、寄存器名打印出来。';
        tokenLog.className = 'stage-log info';
      } else if (kind === 'concat') {
        tokenStage.innerHTML =
          '<div class="token-line">' +
            '<span class="token-chip src">GPIO</span>' +
            '<span class="token-op">##</span>' +
            '<span class="token-chip src">A</span>' +
            '<span class="token-op">→</span>' +
            '<span class="token-chip joined">GPIOA</span>' +
          '</div>' +
          '<div class="token-note">## 把两侧 token 粘成一个新标识符，常用来拼寄存器名。</div>';
        tokenLog.textContent = '拼接发生在预处理阶段，生成的是标识符，不是字符串。';
        tokenLog.className = 'stage-log info';
      } else {
        tokenStage.innerHTML =
          '<div class="token-line">' +
            '<span class="token-chip src">XSTR(__LINE__)</span>' +
            '<span class="token-op">→</span>' +
            '<span class="token-chip src">STR(42)</span>' +
            '<span class="token-op">→</span>' +
            '<span class="token-chip str">"42"</span>' +
          '</div>' +
          '<div class="token-note">先让 __LINE__ 展开成 42，再由内层 STR 字符串化。</div>';
        tokenLog.textContent = '如果直接 STR(__LINE__)，# 会阻止展开，得到的是 "__LINE__"。';
        tokenLog.className = 'stage-log warn';
      }
    }

    const xOutputs = {
      enum: {
        head: '展开结果 · enum',
        log: '一张 PIN_TABLE 生成 enum；加一个引脚只改表里一行。',
        code: '<span class="tok-k">enum</span> pin_id {\n' +
          '    <span class="x-new">PIN_LED</span>,\n' +
          '    <span class="x-new">PIN_BTN</span>,\n' +
          '    <span class="x-new">PIN_UART</span>\n' +
          '};\n' +
          '<span class="tok-k">#define</span> PIN_COUNT  (PIN_UART + <span class="tok-n">1</span>)'
      },
      names: {
        head: '展开结果 · 字符串表',
        log: '同一张表生成名字数组，日志和调试界面直接拿来用。',
        code: '<span class="tok-k">static const char</span> *pin_names[] = {\n' +
          '    <span class="x-new">"LED"</span>,\n' +
          '    <span class="x-new">"BTN"</span>,\n' +
          '    <span class="x-new">"UART"</span>\n' +
          '};'
      },
      init: {
        head: '展开结果 · 初始化表',
        log: '再生成一份硬件配置；引脚表增删，enum、名字和初始化三处同步。',
        code: '<span class="tok-k">static const</span> pin_cfg_t pin_cfgs[] = {\n' +
          '    <span class="x-new">{ GPIOA,  5 }</span>,\n' +
          '    <span class="x-new">{ GPIOC, 13 }</span>,\n' +
          '    <span class="x-new">{ GPIOA,  9 }</span>\n' +
          '};'
      }
    };

    function renderX(kind) {
      $$('.x-tab').forEach(tab => tab.classList.toggle('is-on', tab.dataset.x === kind));
      const out = xOutputs[kind];
      $('#xOutHead').textContent = out.head;
      $('#xOut').innerHTML = '<code>' + out.code + '</code>';
      const logEl = $('#xLog');
      logEl.textContent = out.log;
      logEl.className = 'stage-log info';
    }

    debugToggle.addEventListener('change', renderDebug);
    Object.keys(tokenBtns).forEach(kind => {
      tokenBtns[kind].addEventListener('click', () => selectToken(kind));
    });
    $$('.x-tab').forEach(tab => {
      tab.addEventListener('click', () => renderX(tab.dataset.x));
    });

    // 演示“编译时”的预定义宏值
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const dateEl = $('#ppDate');
    const timeEl = $('#ppTime');
    if (dateEl) {
      dateEl.textContent = months[now.getMonth()] + ' ' +
        String(now.getDate()).padStart(2, ' ') + ' ' + now.getFullYear();
    }
    if (timeEl) {
      timeEl.textContent = now.toTimeString().slice(0, 8);
    }

    renderDebug();
    selectToken('stringify');
    renderX('enum');
  })();

})();
