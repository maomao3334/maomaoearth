/*
 * 本地地球 Local Earth — 工程保存 / 恢复（.leproj，P0）
 * ---------------------------------------------------------------------------
 * .leproj 是纯 JSON（UTF-8），记录相机、地形/影像/性能设置、可恢复图层与
 * Wind3D 风场（URL 或原始 ASC 文本），用于离线保存与恢复工作现场。
 *
 * 对外 API：window.LEProject
 *   init(le)                    初始化（由 'local-earth-ready' 自动触发）
 *   capture() -> object         抓取当前工程状态（不落盘）
 *   save(opts?) -> object       保存并下载 .leproj；opts={name?, download?:false}
 *   load(file) -> Promise       打开 File/Blob（.leproj/.json）
 *   loadText(text) -> Promise   打开 JSON 文本
 *   apply(state) -> Promise     应用工程状态
 *   getLastSaved() -> object?   最近一次保存的工程摘要
 *
 * 可恢复内容：相机（经纬度/高度/heading/pitch/roll）、3D 地形开关与夸张、
 * 卫星影像开关、性能模式、通过 URL 加载的矢量/KML 图层、Wind3D 场景。
 * 不可恢复：拖入的本地 KML/GeoTIFF 等文件（仅记录文件名并提示）、测量几何
 * （仅保存面板文字说明）、2D/3D 视图模式。
 */
(function () {
  'use strict';

  const C = window.Cesium;
  const PROJECT_FORMAT = 'local-earth-project';
  const PROJECT_VERSION = 1;
  const STORE_KEY = 'localEarth.lastProjectName';
  // 启动时的内置图层：恢复工程时保留，不重复加载
  const DEFAULT_LAYER_IDS = new Set(['sample-countries']);
  // 由 LETerrain 管理的影像图层（卫星影像/细节图层）：由 settings.terrain.imagery 控制，
  // 不写入 layers 段，也不在恢复时移除，避免破坏地表影像与地形联动。
  function isTerrainManaged(layer) {
    const name = String((layer && layer.name) || '');
    return /^卫星影像/.test(name) || /地形阴影/.test(name) || /Sentinel-2/i.test(name);
  }

  const state = {
    le: null,
    ready: false,
    urlByLayerId: new Map(),
    lastSaved: null,
  };

  const byId = (id) => document.getElementById(id);

  function nowStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return (
      d.getFullYear() +
      p(d.getMonth() + 1) +
      p(d.getDate()) +
      '-' +
      p(d.getHours()) +
      p(d.getMinutes()) +
      p(d.getSeconds())
    );
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 2000);
  }

  /* --------------------------- 图层 URL 追踪 --------------------------- */
  // 不改 importers.js：包装 LEImports.importUrl，记录「图层 id → 原 URL」，
  // 以便工程保存后能按 URL 恢复公开矢量 / KML / KMZ。
  function installUrlTracker(le) {
    const imports = window.LEImports;
    if (!imports || typeof imports.importUrl !== 'function' || imports.__leProjectWrapped) return;
    const original = imports.importUrl;
    imports.importUrl = async function (url, leArg) {
      const before = new Set(le.listLayers().map((l) => l.id));
      const result = await original.call(this, url, leArg);
      try {
        for (const layer of le.listLayers()) {
          if (!before.has(layer.id)) state.urlByLayerId.set(layer.id, String(url));
        }
      } catch (err) {
        console.warn('[LEProject] 记录图层 URL 失败', err);
      }
      return result;
    };
    imports.__leProjectWrapped = true;
  }

  /* --------------------------- 工程状态抓取 --------------------------- */

  function captureMeasure() {
    const panel = byId('measure-panel');
    if (!panel || panel.classList.contains('hidden')) return null;
    const value = byId('measure-value');
    const detail = byId('measure-detail');
    const parts = [];
    if (value && value.textContent.trim()) parts.push(value.textContent.trim());
    if (detail && detail.textContent.trim()) parts.push(detail.textContent.trim());
    return parts.length ? { text: parts.join(' · '), restorable: false } : null;
  }

  function captureLayer(layer) {
    const rec = {
      id: layer.id,
      name: layer.name,
      type: layer.type,
      visible: layer.visible !== false,
    };
    const url = state.urlByLayerId.get(layer.id);
    if (url) {
      rec.kind = 'url';
      rec.url = url;
      return rec;
    }
    const dsName = layer.datasource && layer.datasource.name ? String(layer.datasource.name) : '';
    if (dsName && /\.(kml|kmz|geojson|json)$/i.test(dsName)) {
      // 通过拖放/“打开数据”载入的本地文件：只记录文件名，无法自动恢复
      rec.kind = 'file';
      rec.file = dsName;
      return rec;
    }
    if (layer.type === 'imagery') {
      rec.kind = 'local';
      rec.note = '本地影像图层无法自动恢复';
      return rec;
    }
    rec.kind = 'unknown';
    return rec;
  }

  function capture() {
    const le = state.le;
    if (!le || !le.viewer) throw new Error('应用尚未就绪');
    const viewer = le.viewer;
    const camera = viewer.camera;
    const carto = camera.positionCartographic;
    if (!carto) throw new Error('无法读取相机位置');

    const T = window.LETerrain;
    const P = window.LEPerf;
    const W = window.LEWindninja;

    const project = {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      app: '本地地球 Local Earth',
      savedAt: new Date().toISOString(),
      camera: {
        longitude: +C.Math.toDegrees(carto.longitude).toFixed(7),
        latitude: +C.Math.toDegrees(carto.latitude).toFixed(7),
        height: +carto.height.toFixed(2),
        heading: +camera.heading.toFixed(6),
        pitch: +camera.pitch.toFixed(6),
        roll: +camera.roll.toFixed(6),
        sceneMode: viewer.scene.mode,
      },
      settings: {
        terrain: {
          enabled: !!(T && T.isEnabled && T.isEnabled()),
          exaggeration: T && T.getExaggeration ? T.getExaggeration() : 1,
          imagery: !!(T && T.isImageryEnabled && T.isImageryEnabled()),
        },
        perfMode: P && P.getMode ? P.getMode() : 'auto',
      },
      layers: [],
      windninja: null,
      measure: captureMeasure(),
    };

    for (const layer of le.listLayers()) {
      if (layer.system) continue;
      if (DEFAULT_LAYER_IDS.has(layer.id)) continue;
      if (layer.type === 'wind3d') continue; // 由 windninja 段记录
      if (isTerrainManaged(layer)) continue; // 由 settings.terrain.imagery 恢复
      project.layers.push(captureLayer(layer));
    }

    if (W && typeof W.getProjectState === 'function') {
      try {
        project.windninja = W.getProjectState();
      } catch (err) {
        console.warn('[LEProject] 抓取 Wind3D 状态失败', err);
      }
    }
    return project;
  }

  /* --------------------------- 保存 --------------------------- */

  function save(opts) {
    const o = opts || {};
    const project = capture();
    const json = JSON.stringify(project, null, 2);
    const name =
      String(o.name || '').trim() ||
      'project-' + nowStamp() + '.leproj';
    const filename = /\.leproj$/i.test(name) || /\.json$/i.test(name) ? name : name + '.leproj';
    if (o.download !== false) {
      downloadBlob(new Blob([json], { type: 'application/json;charset=utf-8' }), filename);
    }
    state.lastSaved = { filename, json, project, bytes: json.length };
    try {
      localStorage.setItem(STORE_KEY, filename);
    } catch (err) {
      /* ignore */
    }
    const le = state.le;
    if (le) {
      if (le.toast) le.toast('工程已保存：' + filename, 'ok', 3200);
      if (le.status) {
        le.status(
          '工程已保存 · 相机 ' +
            project.camera.latitude.toFixed(4) +
            ', ' +
            project.camera.longitude.toFixed(4) +
            ' · 图层 ' +
            project.layers.length +
            (project.windninja ? ' · 含 Wind3D 风场' : '')
        );
      }
    }
    return state.lastSaved;
  }

  /* --------------------------- 读取 / 应用 --------------------------- */

  function parseProject(text) {
    let data;
    try {
      data = JSON.parse(String(text));
    } catch (err) {
      throw new Error('工程文件不是有效 JSON：' + err.message);
    }
    if (!data || typeof data !== 'object') throw new Error('工程文件内容为空');
    if (data.format && data.format !== PROJECT_FORMAT) {
      throw new Error('不是本地地球工程文件（format=' + data.format + '）');
    }
    if (!data.camera) throw new Error('工程文件缺少 camera 段，无法恢复视角');
    if (data.version != null && data.version > PROJECT_VERSION) {
      throw new Error('工程文件版本过新（v' + data.version + '），请升级本地地球');
    }
    return data;
  }

  async function applySettings(project, warnings) {
    const le = state.le;
    const settings = project.settings || {};
    const terrain = settings.terrain || {};

    if (window.LEPerf && settings.perfMode) {
      const mode = settings.perfMode;
      if (['auto', 'low', 'medium', 'high'].indexOf(mode) >= 0) {
        try {
          window.LEPerf.setMode(mode);
        } catch (err) {
          warnings.push('性能模式恢复失败：' + err.message);
        }
      }
    }

    const T = window.LETerrain;
    if (T) {
      try {
        if (typeof terrain.exaggeration === 'number' && T.setExaggeration) {
          const v = T.setExaggeration(terrain.exaggeration);
          const slider = byId('terrain-exaggeration');
          const label = byId('terrain-exaggeration-value');
          if (slider) slider.value = String(v);
          if (label) label.textContent = Number(v).toFixed(1) + '×';
        }
      } catch (err) {
        warnings.push('地形夸张恢复失败：' + err.message);
      }

      const wantTerrain = !!terrain.enabled;
      const hasTerrain = !!(T.isEnabled && T.isEnabled());
      if (wantTerrain !== hasTerrain && typeof T.toggle === 'function') {
        try {
          await T.toggle(le);
        } catch (err) {
          warnings.push('3D 地形开关恢复失败：' + err.message);
        }
      }

      const wantImagery = !!terrain.imagery;
      const hasImagery = !!(T.isImageryEnabled && T.isImageryEnabled());
      if (wantImagery !== hasImagery && typeof T.toggleImagery === 'function') {
        try {
          const on = T.toggleImagery(le);
          const btn = byId('btn-imagery');
          if (btn) btn.textContent = on ? '卫星影像（开）' : '卫星影像（关）';
        } catch (err) {
          warnings.push('卫星影像开关恢复失败：' + err.message);
        }
      }
    }
  }

  async function applyLayers(project, warnings) {
    const le = state.le;
    // 1) 先移除当前非内置、非风场图层，使工程成为唯一真值
    for (const layer of le.listLayers()) {
      if (layer.system) continue;
      if (DEFAULT_LAYER_IDS.has(layer.id)) continue;
      if (layer.type === 'wind3d') continue;
      if (isTerrainManaged(layer)) continue;
      try {
        le.removeLayer(layer.id);
      } catch (err) {
        console.warn('[LEProject] 移除旧图层失败', err);
      }
    }
    state.urlByLayerId.clear();

    // 2) 重新加载可恢复图层
    const layers = Array.isArray(project.layers) ? project.layers : [];
    const imports = window.LEImports;
    for (const rec of layers) {
      if (!rec) continue;
      if (rec.kind === 'url' && rec.url) {
        if (!imports || typeof imports.importUrl !== 'function') {
          warnings.push('无法恢复图层 ' + (rec.name || rec.url) + '：导入模块不可用');
          continue;
        }
        try {
          await imports.importUrl(rec.url);
        } catch (err) {
          warnings.push('图层恢复失败：' + (rec.name || rec.url) + '（' + err.message + '）');
        }
      } else if (rec.kind === 'file') {
        warnings.push('本地文件图层未恢复：' + (rec.file || rec.name) + '（请重新拖入文件）');
      } else if (rec.kind === 'local') {
        warnings.push('本地影像图层未恢复：' + (rec.name || '') + '（请重新加载文件）');
      }
    }
  }

  async function applyWindninja(project, warnings) {
    const W = window.LEWindninja;
    if (!W) return;
    const wind = project.windninja;
    const hasCurrent = typeof W.getStats === 'function' && W.getStats();
    try {
      if (wind) {
        await W.restoreProjectState(wind);
      } else if (hasCurrent && typeof W.clear === 'function') {
        W.clear();
      }
    } catch (err) {
      warnings.push('Wind3D 风场恢复失败：' + err.message);
    }
  }

  function applyCamera(project) {
    const le = state.le;
    const cam = project.camera;
    const viewer = le.viewer;
    try {
      if (viewer.camera.cancelFlight) viewer.camera.cancelFlight();
    } catch (err) {
      /* ignore */
    }
    let heading = Number(cam.heading);
    let pitch = Number(cam.pitch);
    let roll = Number(cam.roll);
    if (!isFinite(heading)) heading = 0;
    if (!isFinite(pitch)) pitch = -Math.PI / 2;
    if (!isFinite(roll)) roll = 0;
    viewer.camera.setView({
      destination: C.Cartesian3.fromDegrees(
        Number(cam.longitude),
        Number(cam.latitude),
        Number(cam.height)
      ),
      orientation: { heading, pitch, roll },
    });
  }

  async function apply(project) {
    const le = state.le;
    if (!le || !le.viewer) throw new Error('应用尚未就绪');
    const warnings = [];
    await applySettings(project, warnings);
    await applyLayers(project, warnings);
    await applyWindninja(project, warnings);
    applyCamera(project);
    if (project.measure && project.measure.text) {
      warnings.push('测量结果仅作记录，未恢复几何：' + project.measure.text);
    }
    const layerCount = le.listLayers().filter((l) => !l.system).length;
    if (le.status) {
      le.status(
        '工程已恢复 · 相机 ' +
          Number(project.camera.latitude).toFixed(4) +
          ', ' +
          Number(project.camera.longitude).toFixed(4) +
          ' · 图层 ' +
          layerCount +
          (project.windninja ? ' · Wind3D' : '') +
          (warnings.length ? ' · ' + warnings.length + ' 条提示' : '')
      );
    }
    if (le.toast) {
      if (warnings.length) le.toast('工程已恢复，有 ' + warnings.length + ' 条提示：' + warnings[0], 'error', 6500);
      else le.toast('工程已恢复', 'ok', 2800);
    }
    return { ok: true, warnings, project };
  }

  async function loadText(text) {
    const project = parseProject(text);
    return await apply(project);
  }

  async function load(file) {
    let text;
    if (typeof file === 'string') {
      const t = file.trim();
      if (t.charAt(0) === '{') text = file;
      else text = await (await fetch(file, { cache: 'no-store' })).text();
    } else if (typeof Blob !== 'undefined' && file instanceof Blob) {
      text = await file.text();
    } else if (file && file.text != null) {
      text = String(file.text);
    } else {
      throw new Error('无法读取工程文件（需要 File/Blob 或 JSON 文本）');
    }
    return await loadText(text);
  }

  /* --------------------------- UI 绑定 --------------------------- */

  function bindUI() {
    const saveBtn = byId('btn-project-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        try {
          save();
        } catch (err) {
          console.error(err);
          if (state.le && state.le.toast) state.le.toast('保存工程失败：' + err.message, 'error', 5000);
        }
      });
    }
    const openBtn = byId('btn-project-open');
    const input = byId('project-file-input');
    if (openBtn && input) {
      openBtn.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (file) {
          load(file)
            .then((res) => console.info('[LEProject] 工程已恢复', res && res.warnings))
            .catch((err) => {
              console.error(err);
              if (state.le && state.le.toast) state.le.toast('打开工程失败：' + err.message, 'error', 6000);
            });
        }
        input.value = '';
      });
    }
  }

  function init(le) {
    if (state.ready) return;
    state.le = le || window.LE;
    if (!state.le || !state.le.viewer) return;
    state.ready = true;
    installUrlTracker(state.le);
    bindUI();
  }

  window.LEProject = {
    init,
    capture,
    save,
    load,
    loadText,
    apply,
    getLastSaved: () => state.lastSaved,
    getLastProjectName: () => {
      try {
        return localStorage.getItem(STORE_KEY) || null;
      } catch (err) {
        return null;
      }
    },
  };

  if (window.LE) init(window.LE);
  else document.addEventListener('local-earth-ready', () => init(window.LE), { once: true });
})();
