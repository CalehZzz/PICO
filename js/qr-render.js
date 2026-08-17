/**
 * Render del QR compartido por el Diseñador y el panel de QR dinámico.
 *
 * Antes cada uno dibujaba por su cuenta: el panel dinámico no pintaba el logo y
 * generaba el código a 220 px, así que se veía distinto y pixelado. Con este
 * módulo los dos parten del mismo estilo y del mismo dibujado.
 */
(function (global) {
  'use strict';

  const DEFAULT_COLOR_STATE = {
    mode: 'solid', color1: '#1D1D1F', color2: '#FF375F', gradType: 'linear', angle: 45
  };

  /** Traduce el estado de color de la UI a las opciones de qr-code-styling. */
  function colorOptionFromState(state) {
    const s = state || DEFAULT_COLOR_STATE;
    if (s.mode === 'gradient') {
      return {
        gradient: {
          type: s.gradType || 'linear',
          rotation: ((s.angle || 0) * Math.PI) / 180,
          colorStops: [
            { offset: 0, color: s.color1 || '#0A84FF' },
            { offset: 1, color: s.color2 || '#FF375F' }
          ]
        }
      };
    }
    return { color: s.color1 || '#1D1D1F' };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * El fondo del logo es un tamaño propio en % del QR; solo crece si el logo
   * no cabría dentro.
   */
  function computeBadgeSize(baseSize, logoMax, badgePct) {
    return Math.max(baseSize * badgePct, logoMax);
  }

  /**
   * qr-code-styling dibuja de forma asíncrona. Leer su <canvas> "cuando exista"
   * devuelve un lienzo en blanco; `getRawData` en cambio espera a que el dibujo
   * termine, así que partimos siempre de una imagen completa.
   */
  async function qrToImage(qr) {
    const blob = await qr.getRawData('png');
    if (!blob) throw new Error('No se pudo generar el QR.');

    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(blob);
      } catch (e) { /* algunos navegadores fallan con blobs PNG: seguimos con Image */ }
    }

    const url = URL.createObjectURL(blob);
    try {
      return await new Promise(function (resolve, reject) {
        const img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('No se pudo leer el QR generado.')); };
        img.src = url;
      });
    } finally {
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
  }

  /** Dibuja el fondo (badge) y el logo centrados, igual en todos los modos. */
  function drawLogo(ctx, size, opts) {
    const logo = opts.logoImage;
    if (!logo) return;

    const pct = Math.max(0, (parseFloat(opts.logoSizePct) || 0) / 100);
    if (pct <= 0) return;

    const logoMax = size * pct;
    const iw = logo.naturalWidth || logo.width;
    const ih = logo.naturalHeight || logo.height;
    let logoW, logoH;
    if (iw >= ih) {
      logoW = logoMax;
      logoH = logoMax * (ih / iw);
    } else {
      logoH = logoMax;
      logoW = logoMax * (iw / ih);
    }

    const shape = opts.logoBgShape || 'rounded';
    const padPct = Math.max(0, (parseFloat(opts.logoPaddingPct) || 0) / 100);
    const badgeSize = computeBadgeSize(size, logoMax, padPct);
    const bx = (size - badgeSize) / 2;
    const by = (size - badgeSize) / 2;

    if (shape !== 'none') {
      ctx.fillStyle = opts.bgColor || '#FFFFFF';
      if (shape === 'circle') {
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, badgeSize / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (shape === 'square') {
        ctx.fillRect(bx, by, badgeSize, badgeSize);
      } else {
        roundRect(ctx, bx, by, badgeSize, badgeSize, badgeSize * 0.22);
        ctx.fill();
      }
    }

    ctx.drawImage(logo, (size - logoW) / 2, (size - logoH) / 2, logoW, logoH);
  }

  /**
   * Genera un canvas con el QR completo (código + fondo del logo + logo).
   * `size` son píxeles reales: para pantalla conviene pedir 2× el tamaño CSS.
   */
  async function renderQrCanvas(opts) {
    if (typeof QRCodeStyling === 'undefined') {
      throw new Error('qr-code-styling no está cargado.');
    }
    const data = String(opts.data || '').trim();
    if (!data) throw new Error('Sin contenido para el QR.');

    const size = Math.max(64, Math.round(opts.size || 512));
    const colorState = opts.colorState || {};

    const qr = new QRCodeStyling({
      width: size,
      height: size,
      type: 'canvas',
      data: data,
      margin: Math.round(size * 0.05),
      qrOptions: { errorCorrectionLevel: opts.errorCorrectionLevel || 'H' },
      dotsOptions: Object.assign(
        { type: opts.dotsType || 'rounded' },
        colorOptionFromState(colorState.dots)
      ),
      cornersSquareOptions: Object.assign(
        { type: opts.csquareType || 'extra-rounded' },
        colorOptionFromState(colorState.csquare)
      ),
      cornersDotOptions: Object.assign(
        { type: opts.cdotType || 'dot' },
        colorOptionFromState(colorState.cdot)
      ),
      backgroundOptions: { color: opts.bgColor || '#FFFFFF' }
    });

    const source = await qrToImage(qr);
    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const ctx = out.getContext('2d');
    ctx.drawImage(source, 0, 0, size, size);
    if (source.close) source.close();
    drawLogo(ctx, size, opts);
    return out;
  }

  /** Opciones de render a partir de un estilo guardado (designPresets / qrStyle). */
  function optionsFromStyle(style, extra) {
    const s = style || {};
    return Object.assign({
      dotsType: s.dotsType || 'rounded',
      csquareType: s.csquareType || 'extra-rounded',
      cdotType: s.cdotType || 'dot',
      colorState: s.colorState || {},
      bgColor: s.bgColor || '#FFFFFF',
      logoBgShape: s.logoBgShape || 'rounded',
      logoSizePct: s.logoSize,
      logoPaddingPct: s.logoPadding
    }, extra || {});
  }

  global.GeneraQRRender = {
    colorOptionFromState,
    computeBadgeSize,
    roundRect,
    renderQrCanvas,
    optionsFromStyle
  };
})(window);
