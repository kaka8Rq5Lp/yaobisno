/* ProductBackgroundRemover — Ya o bisno
   Componente auto-contido (JS puro, sem build): remove o fundo de fotos de produto
   com @imgly/background-removal (modelo descarregado do CDN deles na 1ª utilização).
   Injeta um botão junto ao input de fotos (#pub-image) e um modal com:
     - zona drag&drop laranja "Arrasta a foto do produto"
     - progresso "Removendo fundo... X%" com barra laranja
     - 2 cards: ORIGINAL / SEM FUNDO (fundo xadrez transparente)
     - botão "Usar esta foto no Ya o Bisno" → guarda blob em window.produtoBlobFinal
       e anexa o ficheiro ao formulário de publicar.
   Não depende de classes Tailwind novas — estilos inline, seguro em mobile antigo.
*/
(function () {
  if (window.__productBgRemoverLoaded) return;
  window.__productBgRemoverLoaded = true;

  var LIB_URL = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm';
  var libPromise = null;

  function q(id) { return document.getElementById(id); }

  function loadLib() {
    if (!libPromise) {
      libPromise = import(LIB_URL).catch(function (e) {
        libPromise = null;
        throw e;
      });
    }
    return libPromise;
  }

  function toast(msg) {
    try {
      if (typeof window.toast === 'function') { window.toast(msg); return; }
    } catch (e) {}
    try { alert(msg); } catch (e) {}
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Falha a ler o ficheiro')); };
      r.readAsDataURL(file);
    });
  }

  function flattenWhite(blob) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth || img.width;
          c.height = img.naturalHeight || img.height;
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0);
          c.toBlob(function (b) { resolve(b); }, 'image/png');
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error('Falha a converter para fundo branco')); };
      img.src = URL.createObjectURL(blob);
    });
  }

  function appendThumb(dataUrl) {
    var prev = q('pub-image-preview');
    if (!prev) return;
    var d = document.createElement('div');
    d.style.cssText = 'width:64px;height:64px;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;flex-shrink:0;';
    d.innerHTML = '<img src="' + dataUrl + '" style="width:100%;height:100%;object-fit:cover">';
    prev.appendChild(d);
  }

  function useImage(blob) {
    window.produtoBlobFinal = blob;
    var input = q('pub-image');

    // 1) Anexa o ficheiro ao input (funciona com o fluxo existente de publicar)
    var dtOk = false;
    try {
      if (input && window.DataTransfer && blob) {
        var name = 'foto-sem-fundo-' + Date.now() + '.png';
        var file = new File([blob], name, { type: blob.type || 'image/png' });
        var dt = new DataTransfer();
        Array.prototype.forEach.call(input.files || [], function (f) { try { dt.items.add(f); } catch (e) {} });
        dt.items.add(file);
        input.files = dt.files;
        dtOk = true;
      }
    } catch (e) {}

    // 2) Mostra thumb imediata na preview (independente do input)
    fileToDataUrl(blob).then(function (d) {
      appendThumb(d);
    }).catch(function () {});

    return dtOk;
  }

  var state = { el: null, busy: false };

  function close() {
    if (!state.el) return;
    state.el.style.display = 'none';
    document.body.style.overflow = '';
  }

  function open(file) {
    if (!state.el) return;
    state.el.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    try { file ? start(file) : reset(); } catch (e) {}
  }

  function reset() {
    if (!state.el) return;
    q('bgR_zone').style.display = 'block';
    q('bgR_progress').style.display = 'none';
    q('bgR_result').style.display = 'none';
    q('bgR_err').style.display = 'none';
    q('bgR_zoneIcon').className = q('bgR_zoneIcon').className.replace(/fa-lg/g, 'fa-lg');
    state.busy = false;
  }

  function setProgress(pctTxt, frac) {
    if (!state.el) return;
    q('bgR_progress').style.display = 'block';
    q('bgR_pct').textContent = pctTxt;
    var bar = q('bgR_bar');
    if (bar) bar.style.width = Math.max(2, Math.min(100, Math.round(frac * 100))) + '%';
  }

  function start(file) {
    if (state.busy) return;
    state.busy = true;
    var zone = q('bgR_zone');
    var res = q('bgR_result');
    var err = q('bgR_err');
    zone.style.display = 'block';
    if (res) res.style.display = 'none';
    if (err) err.style.display = 'none';

    // mostra ORIGINAL
    fileToDataUrl(file).then(function (d) {
      var oi = q('bgR_orig');
      if (oi) oi.src = d;
      var ic = q('bgR_zoneIcon');
      if (ic) ic.className = 'fa-solid fa-magic sparkles';
    }).catch(function () {});

    setProgress('A preparar motor de IA... 0%', 0);

    loadLib().then(function (lib) {
      setProgress('Removendo fundo... 0%', 0);
      return lib.removeBackground(file, {
        progress: function (key, current, total) {
          var frac = total && total > 0 ? current / total : 0;
          var p = Math.min(100, Math.round(frac * 100));
          if (key && String(key).indexOf('fetch') === 0) {
            setProgress('Descarregando modelo de IA... ' + p + '%', frac);
          } else {
            setProgress('Removendo fundo... ' + p + '%', frac);
          }
        }
      });
    }).then(function (outBlob) {
      return flattenWhite(outBlob);
    }).then(function (finalBlob) {
      state.busy = false;
      var url = URL.createObjectURL(finalBlob);
      var si = q('bgR_noBg');
      if (si) si.src = url;
      q('bgR_zone').style.display = 'none';
      q('bgR_progress').style.display = 'none';
      q('bgR_err').style.display = 'none';
      q('bgR_result').style.display = 'block';
      q('bgR_use').setAttribute('data-ready', '1');
      window.__pendingRemovedBlob = finalBlob;
    }).catch(function (e) {
      state.busy = false;
      q('bgR_zone').style.display = 'none';
      q('bgR_progress').style.display = 'none';
      q('bgR_err').style.display = 'block';
      var em = q('bgR_errMsg');
      if (em) em.textContent = 'Não foi possível remover o fundo. Verifica a ligação à internet (a IA descarrega ~80MB na primeira vez) e tenta de novo.';
      try { console.error('bg-remover:', e); } catch (x) {}
    });
  }

  function useIt() {
    if (!window.__pendingRemovedBlob) return;
    var ok = useImage(window.__pendingRemovedBlob);
    close();
    toast(ok ? 'Foto sem fundo pronta a publicar!' : 'Foto guardada. Publica para usares esta imagem.');
    window.__pendingRemovedBlob = null;
  }

  function buildButton(input) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'bgRemoveBtn';
    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> <span>Tirar fundo à foto <b>GRÁTIS</b></span>';
    btn.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin:10px 0 4px;padding:13px 16px;border:2px dashed #FF6B00;border-radius:14px;background:#FFF6F0;color:#FF6B00;font-size:13.5px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;';
    btn.onclick = function () { open(null); };
    input.parentNode.insertBefore(btn, input);
  }

  function buildModal() {
    var mask = document.createElement('div');
    mask.id = 'bgRModal';
    mask.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);padding:16px;';
    mask.innerHTML =
      '<div style="width:100%;max-width:400px;max-height:92vh;overflow-y:auto;background:#fff;border-radius:20px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">' +
          '<div style="display:flex;align-items:center;gap:10px;">' +
            '<div style="width:38px;height:38px;border-radius:12px;background:#FFF0E6;color:#FF6B00;display:flex;align-items:center;justify-content:center;font-size:16px;"><i class="fa-solid fa-wand-magic-sparkles"></i></div>' +
            '<div>' +
              '<p style="font-size:15px;font-weight:800;color:#111827;line-height:1.2;">Remover fundo</p>' +
              '<p style="font-size:11px;color:#6B7280;">Fica pronto a publicar</p>' +
            '</div>' +
          '</div>' +
          '<button type="button" id="bgR_close" style="width:34px;height:34px;border-radius:50%;border:none;background:#F3F4F6;color:#6B7280;font-size:15px;cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +

        '<div id="bgR_zone" style="border:2px dashed #FF6B00;border-radius:16px;background:#FFF6F0;padding:26px 14px;text-align:center;cursor:pointer;">' +
          '<div id="bgR_zoneIcon" style="font-size:28px;color:#FF6B00;margin-bottom:8px;"><i class="fa-solid fa-cloud-arrow-up"></i></div>' +
          '<p style="font-size:14px;font-weight:700;color:#FF6B00;">Arrasta a foto do produto</p>' +
          '<p style="font-size:11px;color:#9CA3AF;margin-top:4px;">ou clica aqui para escolher</p>' +
          '<input type="file" accept="image/*" id="bgR_file" style="display:none;">' +
        '</div>' +

        '<div id="bgR_progress" style="display:none;margin-top:14px;">' +
          '<p id="bgR_pct" style="font-size:12.5px;font-weight:600;color:#6B7280;margin-bottom:6px;">Removendo fundo... 0%</p>' +
          '<div style="height:8px;border-radius:999px;background:#F3F4F6;overflow:hidden;">' +
            '<div id="bgR_bar" style="height:100%;border-radius:999px;background:#FF6B00;width:0%;transition:width .2s;"></div>' +
          '</div>' +
        '</div>' +

        '<div id="bgR_err" style="display:none;margin-top:14px;border-radius:12px;background:#FEF2F2;padding:12px;font-size:12px;color:#B91C1C;line-height:1.5;">' +
          '<p style="font-weight:700;margin-bottom:4px;"><i class="fa-solid fa-triangle-exclamation"></i> Erro</p>' +
          '<p id="bgR_errMsg"></p>' +
        '</div>' +

        '<div id="bgR_result" style="display:none;margin-top:14px;">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
            '<div>' +
              '<div style="background:#F3F4F6;border-radius:16px 16px 0 0;padding:7px;text-align:center;font-size:11px;font-weight:700;color:#374151;letter-spacing:.3px;">ORIGINAL</div>' +
              '<div style="border:1px solid #E5E7EB;border-top:none;border-radius:0 0 16px 16px;overflow:hidden;height:190px;display:flex;align-items:center;justify-content:center;background:#fafafa;">' +
                '<img id="bgR_orig" style="max-width:100%;max-height:100%;object-fit:contain;display:block;">' +
              '</div>' +
            '</div>' +
            '<div>' +
              '<div style="background:#FF6B00;border-radius:16px 16px 0 0;padding:7px;text-align:center;font-size:11px;font-weight:700;color:#fff;letter-spacing:.3px;">SEM FUNDO</div>' +
              '<div style="border:1px solid #FFE7D4;border-top:none;border-radius:0 0 16px 16px;overflow:hidden;height:190px;display:flex;align-items:center;justify-content:center;background:#ffffff;">' +
                '<img id="bgR_noBg" style="max-width:100%;max-height:100%;object-fit:contain;display:block;">' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<button type="button" id="bgR_use" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:14px;padding:14px 16px;border:none;border-radius:999px;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 8px 20px rgba(255,107,0,.3);">' +
            '<i class="fa-solid fa-check"></i> Usar esta foto no Ya o Bisno' +
          '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(mask);
    state.el = mask;

    q('bgR_close').onclick = close;
    mask.onclick = function (e) { if (e.target === mask) close(); };

    var zone = q('bgR_zone');
    var input = q('bgR_file');
    zone.onclick = function () { try { input.click(); } catch (e) {} };
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (f) start(f);
    };
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault();
        zone.style.background = '#FFEBD9';
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault();
        zone.style.background = '#FFF6F0';
      });
    });
    zone.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) start(f);
    });

    q('bgR_use').onclick = useIt;
  }

  function init() {
    var input = q('pub-image');
    if (!input) return;
    buildModal();
    buildButton(input);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();