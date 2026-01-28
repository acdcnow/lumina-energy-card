/**
 * Lumina Energy Card
 * Custom Home Assistant card for energy flow visualization
 * Version: 2.0
 * Tested with Home Assistant 2025.12+
 */


// ============================================================================
// Helper Classes for Render Method Refactoring
// ============================================================================

/**
 * SensorDataCollector - Collects and processes sensor data
 */
class SensorDataCollector {
  constructor(hass, getStateSafe) {
    this._hass = hass;
    this.getStateSafe = getStateSafe;
  }

  collectPvData(config) {
    // Optimized: single-pass collection instead of filter+map+reduce
    const pvStringIds = [];
    const pvStringValues = [];
    let pvTotalFromStrings = 0;
    const pvSources = [
      config.sensor_pv1, config.sensor_pv2, config.sensor_pv3,
      config.sensor_pv4, config.sensor_pv5, config.sensor_pv6
    ];
    for (let i = 0; i < pvSources.length; i++) {
      const sensorId = pvSources[i];
      if (sensorId && sensorId !== '') {
        pvStringIds.push(sensorId);
        const value = this.getStateSafe(sensorId);
        pvStringValues.push(value);
        pvTotalFromStrings += value;
      }
    }

    // Optimized: single-pass for array2
    const pvArray2Ids = [];
    const pvArray2Values = [];
    let pvArray2TotalFromStrings = 0;
    const pvArray2Sources = [
      config.sensor_pv_array2_1, config.sensor_pv_array2_2, config.sensor_pv_array2_3,
      config.sensor_pv_array2_4, config.sensor_pv_array2_5, config.sensor_pv_array2_6
    ];
    for (let i = 0; i < pvArray2Sources.length; i++) {
      const sensorId = pvArray2Sources[i];
      if (sensorId && sensorId !== '') {
        pvArray2Ids.push(sensorId);
        const value = this.getStateSafe(sensorId);
        pvArray2Values.push(value);
        pvArray2TotalFromStrings += value;
      }
    }

    const pv_primary_w = config.sensor_pv_total ? this.getStateSafe(config.sensor_pv_total) : pvTotalFromStrings;
    const pv_secondary_w = config.sensor_pv_total_secondary ? this.getStateSafe(config.sensor_pv_total_secondary) : pvArray2TotalFromStrings;
    const total_pv_w = pv_primary_w + pv_secondary_w;

    return {
      pvStringIds,
      pvStringValues,
      pvTotalFromStrings,
      pvArray2Ids,
      pvArray2Values,
      pvArray2TotalFromStrings,
      pv_primary_w,
      pv_secondary_w,
      total_pv_w
    };
  }

  collectBatteryData(config) {
    const mode = (config.battery_power_mode === 'charge_discharge') ? 'charge_discharge' : 'flow';
    // Optimized: pre-filter and cache trimmed values
    const bat_configs = [];
    const batSources = [
      { soc: config.sensor_bat1_soc, pow: config.sensor_bat1_power },
      { soc: config.sensor_bat2_soc, pow: config.sensor_bat2_power },
      { soc: config.sensor_bat3_soc, pow: config.sensor_bat3_power },
      { soc: config.sensor_bat4_soc, pow: config.sensor_bat4_power }
    ];
    for (let i = 0; i < batSources.length; i++) {
      const b = batSources[i];
      if ((b.soc && b.soc !== '') || (b.pow && b.pow !== '')) {
        bat_configs.push(b);
      }
    }

    let total_bat_w = 0;
    let total_soc = 0;
    let active_bat_count = 0;
    let soc_count = 0;

    if (mode === 'charge_discharge') {
      // Optimized: cache type checks to avoid repeated typeof operations
      const chargeRaw = config.sensor_battery_charge;
      const dischargeRaw = config.sensor_battery_discharge;
      const chargeId = (chargeRaw && typeof chargeRaw === 'string') ? chargeRaw.trim() : null;
      const dischargeId = (dischargeRaw && typeof dischargeRaw === 'string') ? dischargeRaw.trim() : null;
      if (chargeId || dischargeId) {
        const chargeState = chargeId && this._hass.states[chargeId];
        const charge_w = (chargeState && chargeState.state !== 'unavailable')
          ? Math.max(0, Number(this.getStateSafe(chargeId)) || 0) : 0;
        const dischargeState = dischargeId && this._hass.states[dischargeId];
        const discharge_w = (dischargeState && dischargeState.state !== 'unavailable')
          ? Math.max(0, Number(this.getStateSafe(dischargeId)) || 0) : 0;
        total_bat_w = charge_w - discharge_w;
        if (charge_w > 0 || discharge_w > 0) active_bat_count = 1;
      }
    } else {
      // Optimized: cache type check to avoid repeated typeof operation
      const flowRaw = config.sensor_battery_flow;
      const flowId = (flowRaw && typeof flowRaw === 'string') ? flowRaw.trim() : null;
      if (flowId) {
        const flowState = this._hass.states[flowId];
        if (flowState && flowState.state !== 'unavailable') {
          const v = this.getStateSafe(flowId);
          if (Number.isFinite(v)) {
            total_bat_w = v;
            active_bat_count = 1;
          }
        }
      }
      if (!flowId || !this._hass.states[flowId] || this._hass.states[flowId].state === 'unavailable') {
        // Optimized: single loop instead of forEach
        for (let i = 0; i < bat_configs.length; i++) {
          const b = bat_configs[i];
          if (b.pow) {
            const powState = this._hass.states[b.pow];
            if (powState && powState.state !== 'unavailable') {
              const powerValue = this.getStateSafe(b.pow);
              if (Number.isFinite(powerValue)) {
                total_bat_w += powerValue;
                active_bat_count++;
              }
            }
          }
        }
      }
    }

    // Optimized: single loop for SOC calculation
    for (let i = 0; i < bat_configs.length; i++) {
      const b = bat_configs[i];
      if (b.soc && b.soc !== '') {
        const socState = this._hass.states[b.soc];
        if (socState && socState.state !== 'unavailable') {
          total_soc += this.getStateSafe(b.soc);
          soc_count++;
        }
      }
    }

    if (!Number.isFinite(total_bat_w)) {
      total_bat_w = 0;
    }

    const avg_soc = soc_count > 0 ? Math.round(total_soc / soc_count) : 0;

    let batteryChargeDaily = 0;
    let batteryDischargeDaily = 0;

    return { total_bat_w, avg_soc, active_bat_count, soc_count, batteryChargeDaily, batteryDischargeDaily };
  }

  collectGridData(config) {
    // Optimized: using shared toNumber function instead of local definition
    let gridNet = 0;
    let gridImport = 0;
    let gridExport = 0;
    let gridImportDaily = 0;
    let gridExportDaily = 0;
    let gridDirection = 1;
    let gridMagnitude = 0;
    let gridActive = false;
    const hasCombinedGrid = Boolean(config.sensor_grid_power);

    // Optimized: cache toUpperCase result and avoid repeated string operations
    const display_unit = config.display_unit || 'W';
    const displayUnitUpper = display_unit.toUpperCase();
    const use_kw = displayUnitUpper === 'KW';
    const gridActivityThreshold = (() => {
      const raw = config.grid_activity_threshold;
      if (raw === undefined || raw === null || raw === '') {
        return DEFAULT_GRID_ACTIVITY_THRESHOLD;
      }
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        return DEFAULT_GRID_ACTIVITY_THRESHOLD;
      }
      return Math.min(Math.max(num, 0), 100000);
    })();

    if (config.sensor_grid_import_daily) {
      const raw = this.getStateSafe(config.sensor_grid_import_daily);
      gridImportDaily = Number.isFinite(Number(raw)) ? Number(raw) : 0;
    }
    if (config.sensor_grid_export_daily) {
      const raw = this.getStateSafe(config.sensor_grid_export_daily);
      gridExportDaily = Number.isFinite(Number(raw)) ? Number(raw) : 0;
    }

    if (hasCombinedGrid) {
      const grid_raw = this.getStateSafe(config.sensor_grid_power);
      const gridAdjusted = config.invert_grid ? (grid_raw * -1) : grid_raw;
      const thresholdedNet = Math.abs(gridAdjusted) < gridActivityThreshold ? 0 : gridAdjusted;
      gridNet = thresholdedNet;
      gridMagnitude = Math.abs(gridNet);
      if (!Number.isFinite(gridMagnitude)) {
        gridMagnitude = 0;
      }
      gridDirection = gridNet > 0 ? 1 : (gridNet < 0 ? -1 : 1);
      gridActive = gridActivityThreshold === 0
        ? gridMagnitude > 0
        : gridMagnitude >= gridActivityThreshold;
      // Calculate gridImport and gridExport from gridNet for display in grid box
      if (gridNet > 0) {
        gridImport = gridNet;
        gridExport = 0;
      } else if (gridNet < 0) {
        gridImport = 0;
        gridExport = Math.abs(gridNet);
      } else {
        gridImport = 0;
        gridExport = 0;
      }
    } else {
      if (config.sensor_grid_import) {
        gridImport = this.getStateSafe(config.sensor_grid_import);
        if (Math.abs(gridImport) < gridActivityThreshold) {
          gridImport = 0;
        }
      }
      if (config.sensor_grid_export) {
        gridExport = this.getStateSafe(config.sensor_grid_export);
        if (Math.abs(gridExport) < gridActivityThreshold) {
          gridExport = 0;
        }
      }
      gridNet = gridImport - gridExport;
      if (config.invert_grid) {
        gridNet *= -1;
        const temp = gridImport;
        gridImport = gridExport;
        gridExport = temp;
      }
      if (Math.abs(gridNet) < gridActivityThreshold) {
        gridNet = 0;
      }
      gridMagnitude = Math.abs(gridNet);
      if (!Number.isFinite(gridMagnitude)) {
        gridMagnitude = 0;
      }
      const preferredDirection = gridImport >= gridExport ? 1 : -1;
      gridDirection = gridNet > 0 ? 1 : (gridNet < 0 ? -1 : preferredDirection);
      gridActive = gridActivityThreshold === 0
        ? gridMagnitude > 0
        : gridMagnitude >= gridActivityThreshold;
    }

    const thresholdMultiplier = use_kw ? 1000 : 1;
    const gridWarningThresholdRaw = toNumber(config.grid_threshold_warning);
    const gridCriticalThresholdRaw = toNumber(config.grid_threshold_critical);
    const gridWarningThreshold = gridWarningThresholdRaw !== null ? gridWarningThresholdRaw * thresholdMultiplier : null;
    const gridCriticalThreshold = gridCriticalThresholdRaw !== null ? gridCriticalThresholdRaw * thresholdMultiplier : null;

    return {
      gridNet,
      gridImport,
      gridExport,
      gridImportDaily,
      gridExportDaily,
      gridDirection,
      gridMagnitude,
      gridActive,
      hasCombinedGrid,
      gridActivityThreshold,
      gridWarningThreshold,
      gridCriticalThreshold,
      use_kw
    };
  }

  collectLoadData(config) {
    const load = this.getStateSafe(config.sensor_home_load);
    const loadSecondary = config.sensor_home_load_secondary ? this.getStateSafe(config.sensor_home_load_secondary) : 0;
    const houseTotalLoad = (Number.isFinite(load) ? load : 0) + (Number.isFinite(loadSecondary) ? loadSecondary : 0);
    const loadValue = Number.isFinite(load) ? load : 0;
    const houseTempState = null;
    const houseTempValue = houseTempState !== null && Number.isFinite(Number(houseTempState)) ? Number(houseTempState) : null;

    return {
      load,
      loadSecondary,
      houseTotalLoad,
      loadValue,
      houseTempValue
    };
  }

  collectAll(config) {
    const pvData = this.collectPvData(config);
    const batteryData = this.collectBatteryData(config);
    const gridData = this.collectGridData(config);
    const loadData = this.collectLoadData(config);

    // Optimized: cache type check and trim result
    const heatPumpSensorRaw = config.sensor_heat_pump_consumption;
    const heatPumpSensorId = (typeof heatPumpSensorRaw === 'string')
      ? heatPumpSensorRaw.trim()
      : (heatPumpSensorRaw || null);
    const hasHeatPumpSensor = Boolean(heatPumpSensorId);
    const heat_pump_w = hasHeatPumpSensor ? this.getStateSafe(heatPumpSensorId) : 0;

    const daily1 = config.sensor_daily ? this.getStateSafe(config.sensor_daily) : 0;
    const daily2 = config.sensor_daily_array2 ? this.getStateSafe(config.sensor_daily_array2) : 0;
    const total_daily_kwh = ((daily1 + daily2) / 1000).toFixed(1);

    return {
      ...pvData,
      ...batteryData,
      ...gridData,
      ...loadData,
      heatPumpSensorId,
      hasHeatPumpSensor,
      heat_pump_w,
      daily1,
      daily2,
      total_daily_kwh
    };
  }
}

// Default values for positions
const DEFAULT_BATTERY_GEOMETRY = { X: 238, Y_BASE: 335, WIDTH: 76, MAX_HEIGHT: 82 };
const DEFAULT_TEXT_POSITIONS = {
  solar: { x: 100, y: 156, rotate: -9.3, skewX: -13, skewY: 1, scaleX: 1, scaleY: 1 },
  battery: { x: 203, y: 332, rotate: -25, skewX: -30, skewY: 5, scaleX: 1, scaleY: 1.05 },
  home: { x: 428, y: 100, rotate: -9, skewX: -20, skewY: 3, scaleX: 1, scaleY: 1 },
  home_temperature: { x: 328, y: 66, rotate: 10, skewX: -20, skewY: 3, scaleX: 1, scaleY: 1 },
  grid: { x: 630, y: 112, rotate: -5.5, skewX: -16, skewY: -5, scaleX: 1, scaleY: 1 },
  heatPump: { x: 282, y: 208, rotate: -36, skewX: -30, skewY: 37, scaleX: 1, scaleY: 1 },
  car1_label: { x: 603, y: 264, rotate: 16, skewX: 20, skewY: 0, scaleX: 1, scaleY: 1 },
  car2_label: { x: 720, y: 295, rotate: 14, skewX: 20, skewY: 0, scaleX: 1, scaleY: 1 },
  car1_power: { x: 597, y: 279, rotate: 16, skewX: 20, skewY: 0, scaleX: 1, scaleY: 1 },
  car1_soc: { x: 595, y: 295, rotate: 16, skewX: 20, skewY: 0, scaleX: 1, scaleY: 1 },
  car2_power: { x: 720, y: 313, rotate: 14, skewX: 20, skewY: 0, scaleX: 1, scaleY: 1 },
  car2_soc: { x: 718, y: 330, rotate: 16, skewX: 20, skewY: 0, scaleX: 1, scaleY: 1 }
};

// ============================================================================
// Optimized Helper Functions - Shared utilities to reduce code duplication
// ============================================================================

/**
 * Safe number conversion with null fallback
 * Optimized: single function used throughout instead of multiple definitions
 */
const toNumber = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

/**
 * Resolve entity ID from primary or legacy config
 * Optimized: extracted to avoid duplication in render method
 */
const resolveEntityId = (primary, legacy) => {
  if (typeof primary === 'string') {
    const trimmed = primary.trim();
    if (trimmed) return trimmed;
  }
  if (typeof legacy === 'string') {
    const trimmed = legacy.trim();
    if (trimmed) return trimmed;
  }
  return '';
};

/**
 * Resolve label from value or fallback
 * Optimized: extracted to avoid duplication
 */
const resolveLabel = (value, fallback) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return fallback;
};

/**
 * Resolve color from value or fallback with validation
 * Optimized: unified implementation replaces 3+ duplicate definitions
 */
const resolveColor = (value, fallback) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && (trimmed.startsWith('#') || trimmed.startsWith('rgb'))) {
      return trimmed;
    }
  }
  if (typeof fallback === 'string') {
    const trimmed = fallback.trim();
    if (trimmed) return trimmed;
  }
  return '#00FFFF';
};

/**
 * Clamp value between min and max with fallback
 * Optimized: extracted to avoid duplication
 */
const clampValue = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, min), max);
};

// ============================================================================
// Layout Helper Functions
// ============================================================================

// Helper function to get text positions from config or defaults
// Optimized: flattened nested loops, cached prefix calculation
const getTextPositions = (config) => {
  const TEXT_TYPES = ['solar', 'battery', 'home', 'home_temperature', 'grid', 'heatPump', 'car1_label', 'car2_label', 'car1_power', 'car1_soc', 'car2_power', 'car2_soc'];
  const TEXT_PROPERTIES = ['x', 'y', 'rotate', 'skewX', 'skewY', 'scaleX', 'scaleY'];
  const result = {};
  
  // Optimized: single loop instead of nested reduce
  for (let typeIdx = 0; typeIdx < TEXT_TYPES.length; typeIdx++) {
    const type = TEXT_TYPES[typeIdx];
    const prefix = type === 'heatPump' ? 'heatpump' : type;
    const typeResult = {};
    const defaults = DEFAULT_TEXT_POSITIONS[type];
    
    for (let propIdx = 0; propIdx < TEXT_PROPERTIES.length; propIdx++) {
      const prop = TEXT_PROPERTIES[propIdx];
      const configKey = `dev_text_${prefix}_${prop}`;
      const def = defaults[prop];
      const v = Number(config[configKey]);
      const valid = Number.isFinite(v);
      
      if (prop === 'scaleX' || prop === 'scaleY') {
        typeResult[prop] = (valid && v > 0) ? v : def;
      } else {
        typeResult[prop] = valid ? v : def;
      }
    }
    result[type] = typeResult;
  }
  
  return result;
};

// Helper function to get battery geometry from config or defaults
const DEFAULT_BATTERY_FILL_ROTATE = -16;
const DEFAULT_BATTERY_FILL_SKEW_X = -14;
const DEFAULT_BATTERY_FILL_SKEW_Y = 32;
const getBatteryGeometry = (config) => {
  return {
    X: Number(config.dev_battery_fill_x) || DEFAULT_BATTERY_GEOMETRY.X,
    Y_BASE: Number(config.dev_battery_fill_y_base) || DEFAULT_BATTERY_GEOMETRY.Y_BASE,
    WIDTH: Number(config.dev_battery_fill_width) || DEFAULT_BATTERY_GEOMETRY.WIDTH,
    MAX_HEIGHT: Number(config.dev_battery_fill_max_height) || DEFAULT_BATTERY_GEOMETRY.MAX_HEIGHT,
    ROTATE: Number(config.dev_battery_fill_rotate) ?? DEFAULT_BATTERY_FILL_ROTATE,
    SKEW_X: Number(config.dev_battery_fill_skew_x) ?? DEFAULT_BATTERY_FILL_SKEW_X,
    SKEW_Y: Number(config.dev_battery_fill_skew_y) ?? DEFAULT_BATTERY_FILL_SKEW_Y
  };
};

// Helper function to get popup positions from config or defaults
const getPopupPositions = (config) => {
  return {
    pv: {
      x: Number(config.dev_popup_pv_x) || 300,
      y: Number(config.dev_popup_pv_y) || 200,
      width: Number(config.dev_popup_pv_width) || 200,
      height: Number(config.dev_popup_pv_height) || 120
    },
    battery: {
      x: Number(config.dev_popup_battery_x) || 300,
      y: Number(config.dev_popup_battery_y) || 200,
      width: Number(config.dev_popup_battery_width) || 200,
      height: Number(config.dev_popup_battery_height) || 120
    },
    grid: {
      x: Number(config.dev_popup_grid_x) || 300,
      y: Number(config.dev_popup_grid_y) || 200,
      width: Number(config.dev_popup_grid_width) || 200,
      height: Number(config.dev_popup_grid_height) || 120
    },
    house: {
      x: Number(config.dev_popup_house_x) || 300,
      y: Number(config.dev_popup_house_y) || 200,
      width: Number(config.dev_popup_house_width) || 200,
      height: Number(config.dev_popup_house_height) || 120
    },
    inverter: {
      x: Number(config.dev_popup_inverter_x) || 300,
      y: Number(config.dev_popup_inverter_y) || 200,
      width: Number(config.dev_popup_inverter_width) || 200,
      height: Number(config.dev_popup_inverter_height) || 120
    }
  };
};

// SOC bar: 6 segments, positioned from path M 330,370 360,360 350,270 320,280 Z (bbox 325,277 30x85)
const DEFAULT_SOC_BAR = { x: 325, y: 277, width: 30, height: 85, rotate: 1, skewX: 2, skewY: -19, opacity: 0.55, glow: 13, colorOn: '#00FFFF', colorOff: '#5aa7c3' };
const getSocBarConfig = (config) => {
  const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    x: n(config.dev_soc_bar_x, DEFAULT_SOC_BAR.x),
    y: n(config.dev_soc_bar_y, DEFAULT_SOC_BAR.y),
    width: Math.max(10, n(config.dev_soc_bar_width, DEFAULT_SOC_BAR.width)),
    height: Math.max(20, n(config.dev_soc_bar_height, DEFAULT_SOC_BAR.height)),
    rotate: n(config.dev_soc_bar_rotate, DEFAULT_SOC_BAR.rotate),
    skewX: n(config.dev_soc_bar_skew_x, DEFAULT_SOC_BAR.skewX),
    skewY: n(config.dev_soc_bar_skew_y, DEFAULT_SOC_BAR.skewY),
    opacity: Math.min(1, Math.max(0.05, n(config.soc_bar_opacity, DEFAULT_SOC_BAR.opacity))),
    glow: Math.max(0, n(config.soc_bar_glow, DEFAULT_SOC_BAR.glow)),
    colorOn: config.soc_bar_color_on && String(config.soc_bar_color_on).trim() ? String(config.soc_bar_color_on).trim() : DEFAULT_SOC_BAR.colorOn,
    colorOff: config.soc_bar_color_off && String(config.soc_bar_color_off).trim() ? String(config.soc_bar_color_off).trim() : DEFAULT_SOC_BAR.colorOff
  };
};

const DEFAULT_GRID_BOX = { x: 607, y: 15, width: 180, height: 67 };
const DEFAULT_PV_BOX = { x: 20, y: 15, width: 169, height: 60 };
const getGridBoxConfig = (config) => {
  const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  // Optimized: using shared resolveColor function instead of local definition
  return { 
    x: n(config.dev_grid_box_x, DEFAULT_GRID_BOX.x), 
    y: n(config.dev_grid_box_y, DEFAULT_GRID_BOX.y), 
    width: Math.max(120, n(config.dev_grid_box_width, DEFAULT_GRID_BOX.width)), 
    height: Math.max(60, n(config.dev_grid_box_height, DEFAULT_GRID_BOX.height)),
    fontSize: n(config.dev_grid_box_font_size, null),
    textColor: resolveColor(config.dev_grid_box_text_color, null)
  };
};
const getPvBoxConfig = (config) => {
  const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  // Optimized: using shared resolveColor function instead of local definition
  return { 
    x: n(config.dev_pv_box_x, DEFAULT_PV_BOX.x), 
    y: n(config.dev_pv_box_y, DEFAULT_PV_BOX.y), 
    width: Math.max(120, n(config.dev_pv_box_width, DEFAULT_PV_BOX.width)), 
    height: Math.max(60, n(config.dev_pv_box_height, DEFAULT_PV_BOX.height)),
    fontSize: n(config.dev_pv_box_font_size, null),
    textColor: resolveColor(config.dev_pv_box_text_color, null)
  };
};

// Phase A Optimization: Cached text transform builder
const buildTextTransform = ({ x, y, rotate, skewX, skewY, scaleX, scaleY }, cache = null) => {
  // Create cache key
  const cacheKey = `${x}-${y}-${rotate}-${skewX}-${skewY}-${scaleX}-${scaleY}`;
  
  // Check cache if provided
  if (cache && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  
  // Calculate transform
  const sx = scaleX != null && scaleX !== 0 ? scaleX : 1;
  const sy = scaleY != null && scaleY !== 0 ? scaleY : 1;
  const scale = (sx !== 1 || sy !== 1) ? ` scale(${sx}, ${sy})` : '';
  const transform = `translate(${x}, ${y}) rotate(${rotate})${scale} skewX(${skewX}) skewY(${skewY}) translate(-${x}, -${y})`;
  
  // Cache if provided
  if (cache) {
    cache.set(cacheKey, transform);
  }
  
  return transform;
};

// Legacy constants for backward compatibility (will use defaults)
// const TEXT_POSITIONS = DEFAULT_TEXT_POSITIONS; // Only use dynamic positions from config
const BATTERY_GEOMETRY = DEFAULT_BATTERY_GEOMETRY;

const FLOW_PATHS = {
  pv1: 'M 193 201 L 415 270',
  pv2: 'M 270 232 L 410 275',
  bat: 'M 416 292 L 353 314',
  load: 'M 480 263 L 566 235 L 475 210',
  grid: 'M 503 269 L 614 233 L 616 200',
  grid_house: 'M 508,198 L 600,220 L 601.4,200',
  car1: 'M 504 300 L 520 305 L 620 270',
  car2: 'M 495 306 L 630 350 L 720 310',
  heatPump: 'M 363,237 L 410,226'
};

// Preset paths for custom flows - easier than writing SVG manually
const PRESET_PATHS = {
  horizontal_lr: { label: '→ Horizontal (Left to Right)', path: 'M 100 225 L 700 225' },
  horizontal_rl: { label: '← Horizontal (Right to Left)', path: 'M 700 225 L 100 225' },
  vertical_tb: { label: '↓ Vertical (Top to Bottom)', path: 'M 400 50 L 400 400' },
  vertical_bt: { label: '↑ Vertical (Bottom to Top)', path: 'M 400 400 L 400 50' },
  diagonal_tl_br: { label: '↘ Diagonal (Top-Left to Bottom-Right)', path: 'M 100 100 L 700 350' },
  diagonal_bl_tr: { label: '↗ Diagonal (Bottom-Left to Top-Right)', path: 'M 100 350 L 700 100' },
  l_shape_down: { label: '⌐ L-Shape (Right then Down)', path: 'M 200 200 L 400 200 L 400 350' },
  l_shape_up: { label: '⌐ L-Shape (Right then Up)', path: 'M 200 350 L 400 350 L 400 200' },
  solar_to_house: { label: '☀→🏠 Solar to House', path: 'M 200 230 L 300 250 L 450 270' },
  grid_to_house: { label: '⚡→🏠 Grid to House', path: 'M 650 150 L 550 200 L 480 230' },
  house_to_grid: { label: '🏠→⚡ House to Grid', path: 'M 480 230 L 550 200 L 650 150' },
  battery_charge: { label: '→🔋 To Battery', path: 'M 400 280 L 350 310 L 300 350' },
  battery_discharge: { label: '🔋→ From Battery', path: 'M 300 350 L 350 310 L 400 280' },
  custom: { label: '✏️ Custom (Manual coordinates)', path: '' }
};

const SVG_DIMENSIONS = { width: 800, height: 450 };
const DEBUG_GRID_SPACING = 25;
const DEBUG_GRID_MAJOR_SPACING = 100;
const DEBUG_GRID_MINOR_COLOR = 'rgba(255, 255, 255, 0.25)';
const DEBUG_GRID_MAJOR_COLOR = 'rgba(255, 255, 255, 0.45)';
const DEBUG_GRID_TEXT_COLOR = 'rgba(255, 255, 255, 0.65)';
const DEBUG_GRID_CONTENT = (() => {
  const parts = [];
  for (let x = 0; x <= SVG_DIMENSIONS.width; x += DEBUG_GRID_SPACING) {
    const isMajor = x % DEBUG_GRID_MAJOR_SPACING === 0;
    const stroke = isMajor ? DEBUG_GRID_MAJOR_COLOR : DEBUG_GRID_MINOR_COLOR;
    const strokeWidth = isMajor ? 1.5 : 0.75;
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${SVG_DIMENSIONS.height}" stroke="${stroke}" stroke-width="${strokeWidth}" />`);
    if (isMajor) {
      parts.push(`<text x="${x + 4}" y="12" fill="${DEBUG_GRID_TEXT_COLOR}" font-size="10" text-anchor="start">X${x}</text>`);
    }
  }
  for (let y = 0; y <= SVG_DIMENSIONS.height; y += DEBUG_GRID_SPACING) {
    const isMajor = y % DEBUG_GRID_MAJOR_SPACING === 0;
    const stroke = isMajor ? DEBUG_GRID_MAJOR_COLOR : DEBUG_GRID_MINOR_COLOR;
    const strokeWidth = isMajor ? 1.5 : 0.75;
    parts.push(`<line x1="0" y1="${y}" x2="${SVG_DIMENSIONS.width}" y2="${y}" stroke="${stroke}" stroke-width="${strokeWidth}" />`);
    if (isMajor) {
      parts.push(`<text x="4" y="${y - 4}" fill="${DEBUG_GRID_TEXT_COLOR}" font-size="10" text-anchor="start">Y${y}</text>`);
    }
  }
  parts.push(`<text x="${SVG_DIMENSIONS.width - 160}" y="${SVG_DIMENSIONS.height - 8}" fill="${DEBUG_GRID_TEXT_COLOR}" font-size="11" text-anchor="start">Z axis points toward the viewer</text>`);
  return parts.join('');
})();

// Enable/disable debug grid overlay for development (set true to show grid)
const DEBUG_GRID_ENABLED = false;

const CAR_TEXT_BASE = { x: 590, rotate: 16, skewX: 20, skewY: 0 };
const CAR_LAYOUTS = {
  single: {
    car1: { x: 590, labelY: 282, powerY: 300, socY: 316, path: 'M 475 329 L 490 335 L 600 285' },
    car2: { x: 590, labelY: 318, powerY: 336, socY: 352, path: 'M 475 341 L 490 347 L 600 310' }
  },
  dual: {
    car1: { x: 580, labelY: 272, powerY: 290, socY: 306, path: 'M 475 329 L 490 335 L 600 285' },
    car2: { x: 639, labelY: 291, powerY: 308, socY: 323, path: 'M 464 320 L 570 357 L 650 310' }
  }
};

const buildCarTextTransforms = (entry, cache = null) => {
  const base = { ...CAR_TEXT_BASE };
  if (typeof entry.x === 'number') {
    base.x = entry.x;
  }
  return {
    label: buildTextTransform({ ...base, y: entry.labelY }, cache),
    power: buildTextTransform({ ...base, y: entry.powerY }, cache),
    soc: buildTextTransform({ ...base, y: entry.socY }, cache)
  };
};

// Helper function to calculate dynamic holographic background dimensions
const calculateHolographicBackground = (text, fontSize, baseWidth = 100, baseHeight = 16) => {
  const textLength = text ? text.toString().length : 1;
  const fontMultiplier = (fontSize || 16) / 16; // Base size is 16px

  // Calculate width based on text length and font size (accounting for letter-spacing and bold font)
  const width = Math.max(baseWidth, textLength * 9 * fontMultiplier + 24);
  // Calculate height accounting for font-weight: bold and better vertical centering
  const height = Math.max(baseHeight, fontSize * 1.4 + 8);

  // Calculate position offsets for centering
  const xOffset = width / 2;
  const yOffset = height / 2;

  return {
    width: Math.round(width),
    height: Math.round(height),
    xOffset: Math.round(xOffset),
    yOffset: Math.round(yOffset)
  };
};

// BATTERY_TRANSFORM and BATTERY_OFFSET_BASE are now calculated dynamically in _buildTemplate

const TXT_STYLE = 'font-weight:bold; font-family: \'Exo 2\', sans-serif; text-anchor:middle; text-shadow: 0 0 5px black;';
const PEARL_WHITE = '#00f9f9';
const FONT_EXO2 = "'Exo 2', sans-serif";
const FLOW_ARROW_COUNT = 5;

// Shared SHA-256 implementation
const LUMINA_SHA256 = (s) => {
  const chrsz = 8;
  const hexcase = 0;
  const safe_add = (x, y) => {
    const lsw = (x & 0xFFFF) + (y & 0xFFFF);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xFFFF);
  };
  const S = (X, n) => (X >>> n) | (X << (32 - n));
  const R = (X, n) => (X >>> n);
  const Ch = (x, y, z) => ((x & y) ^ ((~x) & z));
  const Maj = (x, y, z) => ((x & y) ^ (x & z) ^ (y & z));
  const Sigma0256 = (x) => (S(x, 2) ^ S(x, 13) ^ S(x, 22));
  const Sigma1256 = (x) => (S(x, 6) ^ S(x, 11) ^ S(x, 25));
  const Gamma0256 = (x) => (S(x, 7) ^ S(x, 18) ^ R(x, 3));
  const Gamma1256 = (x) => (S(x, 17) ^ S(x, 19) ^ R(x, 10));
  const core_sha256 = (m, l) => {
    const K = [0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5, 0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174, 0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA, 0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967, 0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85, 0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070, 0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3, 0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2];
    const HASH = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19];
    const W = new Array(64);
    let a, b, c, d, e, f, g, h, i, j;
    let T1, T2;
    m[l >> 5] |= 0x80 << (24 - l % 32);
    m[((l + 64 >> 9) << 4) + 15] = l;
    for (i = 0; i < m.length; i += 16) {
      a = HASH[0]; b = HASH[1]; c = HASH[2]; d = HASH[3]; e = HASH[4]; f = HASH[5]; g = HASH[6]; h = HASH[7];
      for (j = 0; j < 64; j++) {
        if (j < 16) W[j] = m[j + i];
        else W[j] = safe_add(safe_add(safe_add(Gamma1256(W[j - 2]), W[j - 7]), Gamma0256(W[j - 15])), W[j - 16]);
        T1 = safe_add(safe_add(safe_add(safe_add(h, Sigma1256(e)), Ch(e, f, g)), K[j]), W[j]);
        T2 = safe_add(Sigma0256(a), Maj(a, b, c));
        h = g; g = f; f = e; e = safe_add(d, T1); d = c; c = b; b = a; a = safe_add(T1, T2);
      }
      HASH[0] = safe_add(a, HASH[0]); HASH[1] = safe_add(b, HASH[1]); HASH[2] = safe_add(c, HASH[2]); HASH[3] = safe_add(d, HASH[3]);
      HASH[4] = safe_add(e, HASH[4]); HASH[5] = safe_add(f, HASH[5]); HASH[6] = safe_add(g, HASH[6]); HASH[7] = safe_add(h, HASH[7]);
    }
    return HASH;
  };
  const str2binb = (str) => {
    const bin = [];
    const mask = (1 << chrsz) - 1;
    for (let i = 0; i < str.length * chrsz; i += chrsz) {
      bin[i >> 5] |= (str.charCodeAt(i / chrsz) & mask) << (24 - i % 32);
    }
    return bin;
  };
  const Utf8Encode = (string) => {
    string = string.replace(/\r\n/g, '\n');
    let utftext = '';
    for (let n = 0; n < string.length; n++) {
      const c = string.charCodeAt(n);
      if (c < 128) utftext += String.fromCharCode(c);
      else if ((c > 127) && (c < 2048)) {
        utftext += String.fromCharCode((c >> 6) | 192);
        utftext += String.fromCharCode((c & 63) | 128);
      } else {
        utftext += String.fromCharCode((c >> 12) | 224);
        utftext += String.fromCharCode(((c >> 6) & 63) | 128);
        utftext += String.fromCharCode((c & 63) | 128);
      }
    }
    return utftext;
  };
  const binb2hex = (binarray) => {
    const hex_tab = '0123456789abcdef';
    let str = '';
    for (let i = 0; i < binarray.length * 4; i++) {
      str += hex_tab.charAt((binarray[i >> 2] >> ((3 - i % 4) * 8 + 4)) & 0xF) +
             hex_tab.charAt((binarray[i >> 2] >> ((3 - i % 4) * 8)) & 0xF);
    }
    return str;
  };
  const utf8 = Utf8Encode(s);
  return binb2hex(core_sha256(str2binb(utf8), utf8.length * chrsz));
};

// Remote authorization settings (obfuscated)
const LUMINA_REMOTE_URL = atob('aHR0cHM6Ly9naXN0LmdpdGh1YnVzZXJjb250ZW50LmNvbS9HaW9yZ2lvODY2LzExMmIwZTNkZDQ5Yzg1YjE0OTMzMWQ0MGVkOGM3MjM1L3Jhdy9sdW1pbmFfZGI=');
let LUMINA_AUTH_LIST = null;
let LUMINA_FETCHING = false;

const LUMINA_REFRESH_AUTH = async (callback) => {
  if (LUMINA_AUTH_LIST !== null) return LUMINA_AUTH_LIST;
  if (LUMINA_FETCHING) return null;
  LUMINA_FETCHING = true;
  try {
    const r = await fetch(`${LUMINA_REMOTE_URL}?t=${Date.now()}`);
    const text = await r.text();
    // Optimized: combine map+filter into single loop for better performance
    const lines = text.split(/\r?\n/);
    LUMINA_AUTH_LIST = [];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.length === 64) {
        LUMINA_AUTH_LIST.push(trimmed);
      }
    }
    if (callback) callback();
  } catch (e) {
    LUMINA_AUTH_LIST = [];
  } finally {
    LUMINA_FETCHING = false;
  }
  return LUMINA_AUTH_LIST;
};

// Start fetching immediately
LUMINA_REFRESH_AUTH();

const MAX_PV_STRINGS = 6;
const MAX_PV_LINES = MAX_PV_STRINGS + 1;
const PV_LINE_SPACING = 14;
const FLOW_STYLE_DEFAULT = 'dashes';
const FLOW_STYLE_PATTERNS = {
  dashes: { dasharray: '18 12', cycle: 32 },
  dots: { dasharray: '1 16', cycle: 22 },
  arrows: { dasharray: null, cycle: 1 },
  // fluid_flow uses a dash pattern for a moving "highlight" overlay.
  // Use a real "window + gap" so the pulse is visible.
  // We'll add a second, phase-shifted window inside the mask to reduce perceived gaps.
  // The cycle matches dasharray sum for predictable motion.
  // NOTE: This is used by the mask. We create two phase-shifted windows.
  // The gaps must be large enough that blur doesn't fill them in, otherwise
  // the mask becomes nearly solid and motion is hard/impossible to perceive.
  smooth: { dasharray: '0 1000', cycle: 1 },
  shimmer: { dasharray: null, cycle: 276 } // Uses animated gradient instead of dasharray (slower by 50%)
};

const FLOW_BASE_LOOP_RATE = 0.0025;
const FLOW_MIN_GLOW_SCALE = 0.2;
const DEFAULT_GRID_ACTIVITY_THRESHOLD = 100;
const DEFAULT_BATTERY_FILL_HIGH_COLOR = '#00ffff';

const buildArrowGroupSvg = (key, flowState) => {
  const color = flowState && (flowState.glowColor || flowState.stroke) ? (flowState.glowColor || flowState.stroke) : '#00FFFF';
  const activeOpacity = flowState && flowState.active ? 1 : 0;
  const segments = Array.from({ length: FLOW_ARROW_COUNT }, (_, index) =>
    `<polygon data-arrow-shape="${key}" data-arrow-index="${index}" points="-12,-5 0,0 -12,5" fill="${color}" />`
  ).join('');
  return `<g class="flow-arrow" data-arrow-key="${key}" style="opacity:${activeOpacity};">${segments}</g>`;
};

class LuminaEnergyCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._lastRender = 0;
    this._forceRender = false;
    this._rootInitialized = false;
    this._domRefs = null;
    this._prevViewState = null;
    this._eventListenerAttached = false;
    this._flowTweens = new Map();
    this._fluidFlowRafs = new Map();
    this._debugFluidFlow = false;
    this._fluidFlowDebugStopLog = new Map();
    this._fluidFlowDebugColors = new Map();
    this._gsap = null;
    
    // Listen for config-changed events from the editor
    const handleConfigChanged = (e) => {
      if (e.detail && e.detail.config) {
        const config = e.detail.config;
        this.setConfig(config);
      }
    };
    this.addEventListener('config-changed', handleConfigChanged);
    // Also listen on document for events from shadow DOM
    document.addEventListener('config-changed', handleConfigChanged);
    // Also listen on window for events dispatched from parent context
    window.addEventListener('config-changed', handleConfigChanged);
    this._gsapLoading = null;
    this._flowPathLengths = new Map();
    this._animationSpeedFactor = 1;
    this._animationStyle = FLOW_STYLE_DEFAULT;
    this._fluidFlowStrokeWidthPx = 5;
    this._fluidFlowOuterGlowEnabled = false;
    this._defaults = (typeof LuminaEnergyCard.getStubConfig === 'function')
      ? { ...LuminaEnergyCard.getStubConfig() }
      : {};
    this._debugCoordsActive = false;
    this._handleDebugPointerMove = this._handleDebugPointerMove.bind(this);
    this._handleDebugPointerLeave = this._handleDebugPointerLeave.bind(this);
    this._handleEchoAliveClickBound = this._handleEchoAliveClick.bind(this);
    this._echoAliveClickTimeout = null;
    this._textsVisible = 0; // Text visibility state: 0=all visible (default), 1=grid/pv boxes and lines hidden, 2=all hidden
    this._motionLastDetectedAt = null; // timestamp when motion last seen (for 60s keep-alive)
    this._motionHideTimer = null;       // timeout id to re-run visibility after 60s
    this._handleTextToggleClickBound = this._handleTextToggleClick.bind(this);
    this._homePanelExpanded = false;
    this._handleHomeButtonClickBound = this._handleHomeButtonClick.bind(this);
    this._houseIconPopupOverlay = null;
    this._handleHouseIconClickBound = this._handleHouseIconClick.bind(this);
    this._draggingText = null;
    this._solarForecastData = null;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._dragOffsetX = 0;
    this._dragOffsetY = 0;
    this._handleTextMouseDown = this._handleTextMouseDown.bind(this);
    this._handleDocumentMouseMove = this._handleDocumentMouseMove.bind(this);
    this._handleDocumentMouseUp = this._handleDocumentMouseUp.bind(this);
    
    // ============================================================================
    // Phase A Optimizations: Performance improvements
    // ============================================================================
    
    // 1. Render debounce/throttle
    this._renderScheduled = false;
    this._renderTimeoutId = null;
    this._renderDebounceMs = 100; // Max 1 render per 100ms
    
    // 2. State cache for getStateSafe memoization
    this._stateCache = new Map();
    this._stateCacheTimeout = 200; // Cache valid for 200ms
    this._lastHassVersion = null; // Track hass changes to invalidate cache
    
    // 3. Data change detection for skip render
    this._lastDataHash = null;
    
    // 4. DOM updates batching (optional helper for critical updates)
    this._pendingDOMUpdates = [];
    this._domUpdateRafId = null;
    
    // 5. Cache for expensive calculations
    this._textTransformCache = new Map();
    this._colorCache = new Map();
  }
  
  /**
   * Phase A Optimization: Batch DOM updates helper
   * Use this for non-critical DOM updates that can be batched
   * Critical updates (like user interactions) should still be immediate
   */
  _batchDOMUpdate(updateFn) {
    if (typeof updateFn !== 'function') return;
    
    this._pendingDOMUpdates.push(updateFn);
    
    if (!this._domUpdateRafId) {
      this._domUpdateRafId = requestAnimationFrame(() => {
        // Execute all pending updates
        const updates = this._pendingDOMUpdates.slice();
        this._pendingDOMUpdates = [];
        this._domUpdateRafId = null;
        
        for (let i = 0; i < updates.length; i++) {
          try {
            updates[i]();
          } catch (e) {
            // Silently fail individual updates to prevent breaking the batch
          }
        }
      });
    }
  }
  
  /**
   * Phase A Optimization: Cleanup method for performance optimizations
   * Clears timeouts, cache, and pending updates to prevent memory leaks
   */
  _cleanupPerformanceOptimizations() {
    // Clear render debounce timeout
    if (this._renderTimeoutId) {
      clearTimeout(this._renderTimeoutId);
      this._renderTimeoutId = null;
    }
    this._renderScheduled = false;
    
    // Clear DOM update RAF
    if (this._domUpdateRafId) {
      cancelAnimationFrame(this._domUpdateRafId);
      this._domUpdateRafId = null;
    }
    this._pendingDOMUpdates = [];
    
    // Clear state cache
    if (this._stateCache) {
      this._stateCache.clear();
    }
    
    // Clear calculation caches
    if (this._textTransformCache) {
      this._textTransformCache.clear();
    }
    if (this._colorCache) {
      this._colorCache.clear();
    }
    
    // Reset data hash
    this._lastDataHash = null;
  }

  setConfig(config) {
    if (!config) {
      throw new Error('Invalid configuration');
    }
    
    const defaults = this._defaults || {};
    this.config = { ...defaults, ...config };
    this._forceRender = true;
    this._prevViewState = null;
    
    // Initialize text visibility: show texts by default if entities are configured
    // Optimized: check with early exit
    let hasCustomText = false;
    for (let i = 1; i <= 5 && !hasCustomText; i++) {
      if (config[`custom_text_${i}_enabled`] === true) {
        const text = config[`custom_text_${i}_text`];
        const sensor = config[`custom_text_${i}_sensor`];
        if ((text && typeof text === 'string' && text.trim().length > 0) ||
            (sensor && typeof sensor === 'string' && sensor.trim().length > 0)) {
          hasCustomText = true;
        }
      }
    }
    const sensorKeys = [
      'sensor_home_load', 'sensor_home_load_secondary', 'sensor_pv_total', 'sensor_pv_total_secondary',
      'sensor_pv1', 'sensor_pv2', 'sensor_pv3', 'sensor_pv4', 'sensor_pv5', 'sensor_pv6',
      'sensor_pv_array2_1', 'sensor_pv_array2_2', 'sensor_pv_array2_3', 'sensor_pv_array2_4', 'sensor_pv_array2_5', 'sensor_pv_array2_6',
      'sensor_bat1_soc', 'sensor_bat1_power', 'sensor_bat2_soc', 'sensor_bat2_power',
      'sensor_bat3_soc', 'sensor_bat3_power', 'sensor_bat4_soc', 'sensor_bat4_power',
      'sensor_battery_flow', 'sensor_battery_charge', 'sensor_battery_discharge',
      'sensor_grid_power', 'sensor_grid_import', 'sensor_grid_export',
      'sensor_car_power', 'sensor_car_soc', 'sensor_car2_power', 'sensor_car2_soc',
      'sensor_heat_pump_consumption'
    ];
    let hasConfiguredEntities = hasCustomText;
    if (!hasConfiguredEntities) {
      for (let i = 0; i < sensorKeys.length && !hasConfiguredEntities; i++) {
        const val = config[sensorKeys[i]];
        if (val && typeof val === 'string' && val.trim().length > 0) {
          hasConfiguredEntities = true;
        }
      }
    }
    // Initialize to state 0 (all visible) if not already set
    // When toggle button is enabled, default to all visible so text shows without pressing the button.
    if (typeof this._textsVisible !== 'number') {
      this._textsVisible = 0; // State 0: all visible by default
    }

    const hasDeveloperValues = Object.keys(config).some(key => 
      key.startsWith('dev_text_') || 
      key.startsWith('dev_popup_') || 
      key.startsWith('dev_soc_bar_') || key.startsWith('soc_bar_') || key.startsWith('dev_grid_box_') || key.startsWith('dev_pv_box_')
    );
    const isEditorActive = this._isEditorActive();
    const langChanged = config.language != null && this._lastLanguage !== config.language;
    if (langChanged) this._lastLanguage = config.language;

    // Avoid full rebuild when only layout/dev values change in editor (prevents background flicker).
    // Always force rebuild when language changes so box labels etc. update.
    if (hasDeveloperValues && isEditorActive && !langChanged) {
      this._forceRender = false;
    }

    if (this._hass) {
      if (hasDeveloperValues && isEditorActive) {
        this.render();
      } else if (!isEditorActive) {
        this.render();
      }
    } else {
      if (hasDeveloperValues) {
        this._hass = { states: {} };
        this.render();
      }
    }
  }

  set hass(hass) {
    const prevHass = this._hass;
    this._hass = hass;
    if (!this.config) {
      return;
    }
    
    // Check if config has developer values - if so, allow rendering even in editor
    const hasDeveloperValues = this.config && Object.keys(this.config).some(key => 
      key.startsWith('dev_text_') || 
      key.startsWith('dev_popup_') || 
      key.startsWith('dev_soc_bar_') || key.startsWith('soc_bar_') || key.startsWith('dev_grid_box_') || key.startsWith('dev_pv_box_')
    );
    
    if (this._isEditorActive() && !hasDeveloperValues) {
      this._forceRender = false;
      return;
    }
    
    // Do not set _forceRender when editor + dev values (avoids full rebuild / background flicker)
    
    // Update toggle switches immediately if entity states changed; also track text visibility motion sensor
    if (prevHass && hass && hass.states && prevHass.states) {
      const entityIdsToCheck = new Set();
      // Optimized: use for loop instead of forEach for better performance
      const collectEntityIds = (toggles) => {
        if (!toggles || !Array.isArray(toggles)) return;
        for (let i = 0; i < toggles.length; i++) {
          const toggle = toggles[i];
          if (toggle && toggle.getAttribute) {
            const entityId = toggle.getAttribute('data-entity-id');
            if (entityId) entityIdsToCheck.add(entityId);
          }
        }
      };
      if (this._domRefs) {
        collectEntityIds(this._domRefs.pvPopupToggles);
        collectEntityIds(this._domRefs.batteryPopupToggles);
        collectEntityIds(this._domRefs.housePopupToggles);
        collectEntityIds(this._domRefs.gridPopupToggles);
        collectEntityIds(this._domRefs.inverterPopupToggles);
      }
      const motionSensorId = this.config && this.config.text_visibility_sensor ? String(this.config.text_visibility_sensor).trim() : null;
      if (motionSensorId) entityIdsToCheck.add(motionSensorId);
      // Optimized: use for loop instead of forEach for better performance
      const batteryKeys = ['sensor_battery_flow', 'sensor_battery_charge', 'sensor_battery_discharge'];
      for (let i = 0; i < batteryKeys.length; i++) {
        const key = batteryKeys[i];
        const rawId = this.config && this.config[key];
        const id = rawId ? String(rawId).trim() : null;
        if (id) entityIdsToCheck.add(id);
      }
      
      // Check if any tracked entity state changed
      // Optimized: use for...of loop and early exit for better performance
      let stateChanged = false;
      for (const entityId of entityIdsToCheck) {
        const prevState = prevHass.states[entityId] ? prevHass.states[entityId].state : null;
        const newState = hass.states[entityId] ? hass.states[entityId].state : null;
        if (prevState !== newState) {
          stateChanged = true;
          break; // Early exit when change detected
        }
      }
      
      if (stateChanged) {
        this._forceRender = true;
        // Update toggle switches immediately when state changes
        requestAnimationFrame(() => {
          this._updateAllToggleSwitches();
          this._updateTextVisibility();
        });
        // Also update after a short delay to catch any delayed state updates
        setTimeout(() => {
          this._updateAllToggleSwitches();
          this._updateTextVisibility();
        }, 100);
      }
    }
    
    // Phase A Optimization: Debounced render scheduling
    this._scheduleRender();
  }
  
  /**
   * Phase A Optimization: Schedule render with debounce/throttle
   * Prevents excessive renders when hass updates rapidly
   */
  _scheduleRender() {
    const now = Date.now();
    const configuredInterval = Number(this.config.update_interval);
    const intervalSeconds = Number.isFinite(configuredInterval) ? configuredInterval : 3;
    const clampedSeconds = Math.min(Math.max(intervalSeconds, 0), 60);
    const intervalMs = clampedSeconds > 0 ? clampedSeconds * 1000 : 0;
    
    // Force render bypasses debounce
    if (this._forceRender) {
      if (this._renderTimeoutId) {
        clearTimeout(this._renderTimeoutId);
        this._renderTimeoutId = null;
      }
      this._renderScheduled = false;
      this.render();
      this._forceRender = false;
      return;
    }
    
    // Check interval-based rendering
    if (!this._lastRender || intervalMs === 0 || now - this._lastRender >= intervalMs) {
      // Clear any pending debounced render
      if (this._renderTimeoutId) {
        clearTimeout(this._renderTimeoutId);
        this._renderTimeoutId = null;
      }
      this._renderScheduled = false;
      this.render();
      return;
    }
    
    // Debounce: if render already scheduled, cancel and reschedule
    if (this._renderScheduled) {
      if (this._renderTimeoutId) {
        clearTimeout(this._renderTimeoutId);
      }
    }
    
    // Schedule render with debounce
    this._renderScheduled = true;
    const timeSinceLastRender = now - this._lastRender;
    const debounceDelay = Math.max(0, this._renderDebounceMs - timeSinceLastRender);
    
    this._renderTimeoutId = setTimeout(() => {
      this._renderScheduled = false;
      this._renderTimeoutId = null;
      this.render();
    }, debounceDelay);
  }

  static async getConfigElement() {
    return document.createElement('lumina-energy-card-editor');
  }

  static getStubConfig() {
    return {
      language: 'en',
      card_title: '',
      background_image: '/local/community/lumina-energy-card/lumina_background1.png',
      background_image_heat_pump: '/local/community/lumina-energy-card/lumina-energy-card-hp.png',
      pro_password: null,
      overlay_image_enabled: false,
      overlay_image: '/local/community/lumina-energy-card/car.png',
      overlay_image_x: 0,
      overlay_image_y: 0,
      overlay_image_width: 800,
      overlay_image_height: 450,
      overlay_image_opacity: 1.0,
      overlay_image_2_enabled: false,
      overlay_image_2: '/local/community/lumina-energy-card/car_real.png',
      overlay_image_2_x: 0,
      overlay_image_2_y: 0,
      overlay_image_2_width: 800,
      overlay_image_2_height: 450,
      overlay_image_2_opacity: 1.0,
      overlay_image_3_enabled: false,
      overlay_image_3: '/local/community/lumina-energy-card/Pool.png',
      overlay_image_3_x: 0,
      overlay_image_3_y: 0,
      overlay_image_3_width: 800,
      overlay_image_3_height: 450,
      overlay_image_3_opacity: 1.0,
      overlay_image_4_enabled: false,
      overlay_image_4: '/local/community/lumina-energy-card/pool_real.png',
      overlay_image_4_x: 0,
      overlay_image_4_y: 0,
      overlay_image_4_width: 800,
      overlay_image_4_height: 450,
      overlay_image_4_opacity: 1.0,
      overlay_image_5_enabled: false,
      overlay_image_5: '/local/community/lumina-energy-card/turbine.png',
      overlay_image_5_x: 0,
      overlay_image_5_y: 0,
      overlay_image_5_width: 800,
      overlay_image_5_height: 450,
      overlay_image_5_opacity: 1.0,
      // Custom flows (up to 5)
      custom_flow_1_enabled: false,
      custom_flow_1_sensor: null,
      custom_flow_1_path: null,
      custom_flow_1_color: '#00FFFF',
      custom_flow_1_threshold: 10,
      custom_flow_1_direction: 'auto', // 'forward', 'reverse', 'auto'
      custom_flow_1_offset_x: 0,
      custom_flow_1_offset_y: 0,
      custom_flow_2_enabled: false,
      custom_flow_2_sensor: null,
      custom_flow_2_path: null,
      custom_flow_2_color: '#00FFFF',
      custom_flow_2_threshold: 10,
      custom_flow_2_direction: 'auto',
      custom_flow_2_offset_x: 0,
      custom_flow_2_offset_y: 0,
      custom_flow_3_enabled: false,
      custom_flow_3_sensor: null,
      custom_flow_3_path: null,
      custom_flow_3_color: '#00FFFF',
      custom_flow_3_threshold: 10,
      custom_flow_3_direction: 'auto',
      custom_flow_3_offset_x: 0,
      custom_flow_3_offset_y: 0,
      custom_flow_4_enabled: false,
      custom_flow_4_sensor: null,
      custom_flow_4_path: null,
      custom_flow_4_color: '#00FFFF',
      custom_flow_4_threshold: 10,
      custom_flow_4_direction: 'auto',
      custom_flow_4_offset_x: 0,
      custom_flow_4_offset_y: 0,
      custom_flow_5_enabled: false,
      custom_flow_5_sensor: null,
      custom_flow_5_path: null,
      custom_flow_5_color: '#00FFFF',
      custom_flow_5_threshold: 10,
      custom_flow_5_direction: 'auto',
      custom_flow_5_offset_x: 0,
      custom_flow_5_offset_y: 0,
      custom_flow_1_path_preset: 'custom',
      custom_flow_2_path_preset: 'custom',
      custom_flow_3_path_preset: 'custom',
      custom_flow_4_path_preset: 'custom',
      custom_flow_5_path_preset: 'custom',
      linea_box_1_path: 'M 664,130 730,95 V 82',
      linea_box_2_path: 'M 17,200 8.9,190 9.2,83 89,76',
      custom_flow_1_start_x: 100,
      custom_flow_1_start_y: 200,
      custom_flow_1_end_x: 600,
      custom_flow_1_end_y: 250,
      custom_flow_2_start_x: 100,
      custom_flow_2_start_y: 200,
      custom_flow_2_end_x: 600,
      custom_flow_2_end_y: 250,
      custom_flow_3_start_x: 100,
      custom_flow_3_start_y: 200,
      custom_flow_3_end_x: 600,
      custom_flow_3_end_y: 250,
      custom_flow_4_start_x: 100,
      custom_flow_4_start_y: 200,
      custom_flow_4_end_x: 600,
      custom_flow_4_end_y: 250,
      custom_flow_5_start_x: 100,
      custom_flow_5_start_y: 200,
      custom_flow_5_end_x: 600,
      custom_flow_5_end_y: 250,
      // Layout: text positions (X, Y px; rotation; skew; scale). Area 800×450.
      dev_text_solar_x: 100,
      dev_text_solar_y: 156,
      dev_text_solar_rotate: -9.3,
      dev_text_solar_skewX: -13,
      dev_text_solar_skewY: 1,
      dev_text_solar_scaleX: 1,
      dev_text_solar_scaleY: 1,
      dev_text_battery_x: 203,
      dev_text_battery_y: 332,
      dev_text_battery_rotate: -25,
      dev_text_battery_skewX: -30,
      dev_text_battery_skewY: 5,
      dev_text_battery_scaleX: 1,
      dev_text_battery_scaleY: 1.05,
      dev_text_home_x: 428,
      dev_text_home_y: 100,
      dev_text_home_rotate: -9,
      dev_text_home_skewX: -20,
      dev_text_home_skewY: 3,
      dev_text_home_scaleX: 1,
      dev_text_home_scaleY: 1,
      dev_text_home_temperature_x: 328,
      dev_text_home_temperature_y: 66,
      dev_text_home_temperature_rotate: 10,
      dev_text_home_temperature_skewX: -20,
      dev_text_home_temperature_skewY: 3,
      dev_text_home_temperature_scaleX: 1,
      dev_text_home_temperature_scaleY: 1,
      dev_text_grid_x: 630,
      dev_text_grid_y: 112,
      dev_text_grid_rotate: -5.5,
      dev_text_grid_skewX: -16,
      dev_text_grid_skewY: -5,
      dev_text_grid_scaleX: 1,
      dev_text_grid_scaleY: 1,
      dev_text_heatpump_x: 282,
      dev_text_heatpump_y: 208,
      dev_text_heatpump_rotate: -36,
      dev_text_heatpump_skewX: -30,
      dev_text_heatpump_skewY: 37,
      dev_text_heatpump_scaleX: 1,
      dev_text_heatpump_scaleY: 1,
      dev_text_car1_label_x: 603,
      dev_text_car1_label_y: 264,
      dev_text_car1_label_rotate: 16,
      dev_text_car1_label_skewX: 20,
      dev_text_car1_label_skewY: 0,
      dev_text_car1_label_scaleX: 1,
      dev_text_car1_label_scaleY: 1,
      dev_text_car2_label_x: 720,
      dev_text_car2_label_y: 295,
      dev_text_car2_label_rotate: 14,
      dev_text_car2_label_skewX: 20,
      dev_text_car2_label_skewY: 0,
      dev_text_car2_label_scaleX: 1,
      dev_text_car2_label_scaleY: 1,
      dev_text_car1_power_x: 597,
      dev_text_car1_power_y: 279,
      dev_text_car1_power_rotate: 16,
      dev_text_car1_power_skewX: 20,
      dev_text_car1_power_skewY: 0,
      dev_text_car1_power_scaleX: 1,
      dev_text_car1_power_scaleY: 1,
      dev_text_car1_soc_x: 595,
      dev_text_car1_soc_y: 295,
      dev_text_car1_soc_rotate: 16,
      dev_text_car1_soc_skewX: 20,
      dev_text_car1_soc_skewY: 0,
      dev_text_car1_soc_scaleX: 1,
      dev_text_car1_soc_scaleY: 1,
      dev_text_car2_power_x: 720,
      dev_text_car2_power_y: 313,
      dev_text_car2_power_rotate: 14,
      dev_text_car2_power_skewX: 20,
      dev_text_car2_power_skewY: 0,
      dev_text_car2_power_scaleX: 1,
      dev_text_car2_power_scaleY: 1,
      dev_text_car2_soc_x: 718,
      dev_text_car2_soc_y: 330,
      dev_text_car2_soc_rotate: 16,
      dev_text_car2_soc_skewX: 20,
      dev_text_car2_soc_skewY: 0,
      dev_text_car2_soc_scaleX: 1,
      dev_text_car2_soc_scaleY: 1,
      dev_soc_bar_x: 325,
      dev_soc_bar_y: 277,
      dev_soc_bar_width: 30,
      dev_soc_bar_height: 85,
      dev_soc_bar_rotate: 1,
      dev_soc_bar_skew_x: 2,
      dev_soc_bar_skew_y: -19,
      soc_bar_opacity: 0.55,
      soc_bar_glow: 13,
      soc_bar_color_on: '#00FFFF',
      soc_bar_color_off: '#5aa7c3',
      ...Object.fromEntries([...['camera', 'lights', 'temperature', 'security', 'humidity'].flatMap(k => [1, 2, 3, 4, 5, 6].map(i => [`house_${k}_${i}`, '']))]),
      dev_grid_box_x: 607,
      dev_grid_box_y: 15,
      dev_grid_box_width: 180,
      dev_grid_box_height: 67,
      dev_grid_box_font_size: 10,
      dev_pv_box_x: 20,
      dev_pv_box_y: 15,
      dev_pv_box_width: 169,
      dev_pv_box_height: 60,
      dev_pv_box_font_size: 10,
      // Custom Text Labels
      custom_text_1_enabled: false,
      custom_text_1_text: '',
      custom_text_1_sensor: null,
      custom_text_1_x: 400,
      custom_text_1_y: 100,
      custom_text_1_color: '#00f9f9',
      custom_text_1_size: 16,
      custom_text_2_enabled: false,
      custom_text_2_text: '',
      custom_text_2_sensor: null,
      custom_text_2_x: 400,
      custom_text_2_y: 150,
      custom_text_2_color: '#00f1f2',
      custom_text_2_size: 16,
      custom_text_3_enabled: false,
      custom_text_3_text: '',
      custom_text_3_sensor: null,
      custom_text_3_x: 400,
      custom_text_3_y: 200,
      custom_text_3_color: '#00f1f2',
      custom_text_3_size: 16,
      custom_text_4_enabled: false,
      custom_text_4_text: '',
      custom_text_4_sensor: null,
      custom_text_4_x: 400,
      custom_text_4_y: 250,
      custom_text_4_color: '#00f1f2',
      custom_text_4_size: 16,
      custom_text_5_enabled: false,
      custom_text_5_text: '',
      custom_text_5_sensor: null,
      custom_text_5_x: 400,
      custom_text_5_y: 300,
      custom_text_5_color: '#00f1f2',
      custom_text_5_size: 16,
      // Solar Forecast
      solar_forecast_enabled: false,
      sensor_solar_forecast: null,
      solar_forecast_max_power: 10000, // Max power in W for percentage calculation
      solar_forecast_x: 400,
      solar_forecast_y: 350,
      solar_forecast_color: '#00FFFF',
      solar_forecast_size: 16,
      text_font_size: 12, // Unified font size for all text elements
      header_font_size: 16,
      daily_label_font_size: 12,
      daily_value_font_size: 12,
      pv_font_size: 12,
      pv_text_color: '#00f9f9',
      pv_secondary_text_color: '#00f9f9',
      pv_secondary_font_size: 12,
      battery_soc_font_size: 12,
      battery_power_font_size: 12,
      battery_font_size: 12,
      battery_text_color: '#00f9f9',
      load_font_size: 12,
      house_font_size: 12,
      house_text_color: '#00f9f9',
      heat_pump_font_size: 12,
      grid_font_size: 12,
      grid_text_color: '#00f9f9',
      car_font_size: 12,
      car_text_color: '#00f9f9',
      car_power_font_size: 12,
      car_soc_font_size: 12,
      car2_power_font_size: 12,
      car2_soc_font_size: 12,
        car_name_font_size: 12, // Schriftgroesse Fahrzeugname (px)
        car2_name_font_size: 12, // Schriftgroesse Fahrzeugname 2 (px)
      animation_speed_factor: 1,
      animation_style: 'shimmer',
      image_style: 'holographic', // 'holographic' | 'real' — first choice in installation type
      installation_type: '1', // '1' = PV + Auto, '2' = PV senza Auto, '3' = No PV No Auto
            sensor_pv_total: '',
          sensor_pv_total_secondary: '',
      sensor_pv1: '',
      sensor_daily: '',
      sensor_daily_array2: '',
      sensor_bat1_soc: '',
      sensor_bat1_power: '',
      sensor_home_load: '',
      sensor_home_load_secondary: '',
      sensor_heat_pump_consumption: '',
      sensor_house_temperature: '',
      house_temperature_offset_x: -100,
      house_temperature_offset_y: -218,
      house_temperature_rotation: 10,
      sensor_grid_power: '',
      sensor_grid_import: '',
      sensor_grid_export: '',
      sensor_car2_power: '',
      sensor_car2_soc: '',
      pv_primary_color: '#0080ff',
      pv_tot_color: '#00f9f9',
      pv_secondary_color: '#80ffff',
      pv_string1_color: '#80ffff',
      pv_string2_color: '#80ffff',
      pv_string3_color: '#80ffff',
      pv_string4_color: '#80ffff',
      pv_string5_color: '#80ffff',
      pv_string6_color: '#80ffff',
      load_flow_color: '#0080ff',
      load_text_color: '#00f1f2',
      inv1_color: '#0080ff',
      inv2_color: '#80ffff',
      load_threshold_warning: null,
      load_warning_color: '#ff8000',
      load_threshold_critical: null,
      load_critical_color: '#ff0000',
      battery_soc_color: '#00f9f9',
      battery_charge_color: '#00FFFF',
      battery_discharge_color: '#00f9f9',
      grid_import_color: '#FF3333',
      grid_export_color: '#00ff00',
      car_flow_color: '#00FFFF',
      car1_color: '#00f9f9',
      car2_color: '#00f9f9',
      car1_name_color: '#00f9f9',
      car2_name_color: '#00f9f9',
      car2_pct_color: '#00FFFF',
      heat_pump_flow_color: '#FFA500',
      heat_pump_text_color: '#00f9f9',
      show_car_soc: false,
      show_car2: false,
      car1_bidirectional: false,
      car2_bidirectional: false,
      car1_invert_flow: false,
      car2_invert_flow: false,
      array1_invert_flow: false,
      array2_invert_flow: false,
      invert_battery: false,
      battery_power_mode: 'flow',
      sensor_battery_flow: '',
      sensor_battery_charge: '',
      sensor_battery_discharge: '',
      grid_activity_threshold: DEFAULT_GRID_ACTIVITY_THRESHOLD,
      grid_threshold_warning: null,
      grid_warning_color: '#ff8000',
      grid_threshold_critical: null,
      grid_critical_color: '#ff0000',
      show_pv_strings: false,
      display_unit: 'kW',
      update_interval: 3,
      enable_echo_alive: false,
      enable_text_toggle_button: true,
      text_toggle_button_x: 30, // Moved 20px to the right from original position (10px)
      text_toggle_button_y: null, // null = bottom, otherwise top
      text_toggle_button_scale: 1.0,
      text_visibility_sensor: null,
      fluid_flow_outer_glow: false,
      flow_stroke_width: 1,
      fluid_flow_stroke_width: 3,
      // Flow Path offsets (in pixels)
      pv1_flow_offset_x: 0,
      pv1_flow_offset_y: 0,
      pv2_flow_offset_x: 0,
      pv2_flow_offset_y: 0,
      bat_flow_offset_x: 0,
      bat_flow_offset_y: 0,
      load_flow_offset_x: 0,
      load_flow_offset_y: 0,
      grid_flow_offset_x: 0,
      grid_flow_offset_y: 0,
      grid_house_flow_offset_x: 0,
      grid_house_flow_offset_y: 0,
      car1_flow_offset_x: 0,
      car1_flow_offset_y: 0,
      car2_flow_offset_x: 0,
      car2_flow_offset_y: 0,
      heat_pump_flow_offset_x: 0,
      heat_pump_flow_offset_y: 0,
      // Custom Flow Paths (SVG path strings)
      pv1_flow_path: FLOW_PATHS.pv1,
      pv2_flow_path: FLOW_PATHS.pv2,
      bat_flow_path: FLOW_PATHS.bat,
      load_flow_path: FLOW_PATHS.load,
      grid_flow_path: FLOW_PATHS.grid,
      grid_house_flow_path: FLOW_PATHS.grid_house,
      car1_flow_path: FLOW_PATHS.car1,
      car2_flow_path: FLOW_PATHS.car2,
      heat_pump_flow_path: FLOW_PATHS.heatPump
    };
  }

  _isEditorActive() {
    return Boolean(this.closest('hui-card-preview'));
  }

  disconnectedCallback() {
    // Phase A Optimization: Cleanup performance optimizations on disconnect
    this._cleanupPerformanceOptimizations();
    
    if (typeof super.disconnectedCallback === 'function') {
      super.disconnectedCallback();
    }
    if (this._motionHideTimer) {
      clearTimeout(this._motionHideTimer);
      this._motionHideTimer = null;
    }
    this._closeHouseIconPopup();
    this._teardownFlowAnimations();
    if (this._echoAliveClickTimeout) {
      try {
        clearTimeout(this._echoAliveClickTimeout);
      } catch (e) {
        // ignore
      }
      this._echoAliveClickTimeout = null;
    }
    this._domRefs = null;
    this._prevViewState = null;
    this._eventListenerAttached = false;
    this._rootInitialized = false;
  }

  _applyFlowAnimationTargets(flowDurations, flowStates) {
    if (!this._domRefs || !this._domRefs.flows) {
      return;
    }

    const execute = () => {
      if (!this._domRefs || !this._domRefs.flows) {
        return;
      }
      const flowElements = this._domRefs.flows;
      const seenKeys = new Set();

      Object.entries(flowDurations || {}).forEach(([flowKey, seconds]) => {
        const element = flowElements[flowKey];
        if (!element) {
          return;
        }
        seenKeys.add(flowKey);
        const state = flowStates && flowStates[flowKey] ? flowStates[flowKey] : undefined;
        this._syncFlowAnimation(flowKey, element, seconds, state);
      });

      this._flowTweens.forEach((entry, key) => {
        if (!seenKeys.has(key)) {
          this._killFlowEntry(entry);
          this._flowTweens.delete(key);
        }
      });
    };

    // Execute immediately to start animations without waiting for GSAP
    // GSAP will be loaded asynchronously in the background for effects that need it
    execute();

    // Phase A Optimization: Lazy Load GSAP - only load if animations are enabled
    // Skip GSAP loading if animations are disabled (saves ~100KB download)
    const animationStyle = this._normalizeAnimationStyle(this.config?.animation_style);
    const needsGsap = animationStyle !== 'none' && animationStyle !== 'dashes';
    
    if (needsGsap && !this._gsap && !this._gsapLoading) {
      // Load GSAP only when needed (lazy load)
      this._ensureGsap().catch((error) => {
        // Silently fail - animations will work without GSAP (fallback)
      });
    }
    // If animations disabled, GSAP is never loaded (performance optimization)
  }

  _ensureGsap() {
    if (this._gsap) {
      return Promise.resolve(this._gsap);
    }
    if (this._gsapLoading) {
      return this._gsapLoading;
    }

    const moduleCandidates = [
      'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js?module',
      'https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js'
    ];
    const scriptCandidates = [
      'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js'
    ];

    const resolveCandidate = (module) => {
      const candidate = module && (module.gsap || module.default || module);
      if (candidate && typeof candidate.to === 'function') {
        this._gsap = candidate;
        return this._gsap;
      }
      if (typeof window !== 'undefined' && window.gsap && typeof window.gsap.to === 'function') {
        this._gsap = window.gsap;
        return this._gsap;
      }
      throw new Error('Lumina Energy Card: GSAP module missing expected exports');
    };

    const ensureGlobalGsap = () => {
      if (typeof window !== 'undefined' && window.gsap && typeof window.gsap.to === 'function') {
        this._gsap = window.gsap;
        return this._gsap;
      }
      throw new Error('Lumina Energy Card: GSAP global not available after script load');
    };

    const attemptModuleLoad = (index) => {
      if (index >= moduleCandidates.length) {
        return Promise.reject(new Error('Lumina Energy Card: module imports exhausted'));
      }
      return import(moduleCandidates[index])
        .then(resolveCandidate)
        .catch((error) => {
          return attemptModuleLoad(index + 1);
        });
    };

    const loadScript = (url) => {
      if (typeof document === 'undefined') {
        return Promise.reject(new Error('Lumina Energy Card: document not available for GSAP script load'));
      }

      const existing = document.querySelector(`script[data-lumina-gsap="${url}"]`);
      if (existing && existing.dataset.loaded === 'true') {
        try {
          return Promise.resolve(ensureGlobalGsap());
        } catch (err) {
          return Promise.reject(err);
        }
      }
      if (existing) {
        return new Promise((resolve, reject) => {
          existing.addEventListener('load', () => {
            try {
              resolve(ensureGlobalGsap());
            } catch (err) {
              reject(err);
            }
          }, { once: true });
          existing.addEventListener('error', (event) => reject(event?.error || new Error(`Lumina Energy Card: failed to load GSAP script ${url}`)), { once: true });
        });
      }

      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.dataset.luminaGsap = url;
        script.addEventListener('load', () => {
          script.dataset.loaded = 'true';
          try {
            resolve(ensureGlobalGsap());
          } catch (err) {
            reject(err);
          }
        }, { once: true });
        script.addEventListener('error', (event) => {
          script.dataset.loaded = 'error';
          reject(event?.error || new Error(`Lumina Energy Card: failed to load GSAP script ${url}`));
        }, { once: true });
        document.head.appendChild(script);
      });
    };

    const attemptScriptLoad = (index) => {
      if (index >= scriptCandidates.length) {
        return Promise.reject(new Error('Lumina Energy Card: script fallbacks exhausted'));
      }
      return loadScript(scriptCandidates[index])
        .catch((error) => {
          return attemptScriptLoad(index + 1);
        });
    };

    this._gsapLoading = attemptScriptLoad(0)
      .catch((scriptError) => {
        return attemptModuleLoad(0);
      })
      .catch((error) => {
        this._gsapLoading = null;
        throw error;
      });

    return this._gsapLoading;
  }

  _syncFlowAnimation(flowKey, element, seconds, flowState) {
    const animationStyle = this._animationStyle || FLOW_STYLE_DEFAULT;
    const isShimmer = animationStyle === 'shimmer';
    
    if (flowState && flowState.active && this._flowTweens) {
      const entry = this._flowTweens.get(flowKey);
    }
    if (!element) {
      return;
    }
    const pattern = FLOW_STYLE_PATTERNS[animationStyle] || FLOW_STYLE_PATTERNS[FLOW_STYLE_DEFAULT];
    const useArrows = animationStyle === 'arrows';
    const arrowGroup = useArrows && this._domRefs && this._domRefs.arrows ? this._domRefs.arrows[flowKey] : null;
    const arrowShapes = useArrows && this._domRefs && this._domRefs.arrowShapes ? this._domRefs.arrowShapes[flowKey] : null;
    const dashReferenceCycle = FLOW_STYLE_PATTERNS.dashes && Number.isFinite(FLOW_STYLE_PATTERNS.dashes.cycle)
      ? FLOW_STYLE_PATTERNS.dashes.cycle
      : 32;
    const pathLength = useArrows ? this._getFlowPathLength(flowKey) : 0;
    let resolvedPathLength = pathLength;
    if (!Number.isFinite(resolvedPathLength) || resolvedPathLength <= 0) {
      resolvedPathLength = this._getFlowPathLength(flowKey);
    }
    const strokeColor = flowState && (flowState.glowColor || flowState.stroke) ? (flowState.glowColor || flowState.stroke) : '#00FFFF';
    let speedFactor = Number(this._animationSpeedFactor);
    if (!Number.isFinite(speedFactor)) {
      speedFactor = 1;
    }
    const speedMagnitude = Math.abs(speedFactor);
    const directionSign = speedFactor < 0 ? -1 : 1;
    // fluid_flow is visually more "sensitive" than dashed styles because the mask window
    // reads as continuous motion; scale it down so speed=1 matches the old ~0.25 feel.
    const fluidFlowSpeedScale = 1;
    const baseLoopRate = this._computeFlowLoopRate(speedMagnitude * fluidFlowSpeedScale);
    let loopRate = baseLoopRate;
    if (useArrows) {
      if (Number.isFinite(resolvedPathLength) && resolvedPathLength > 0) {
        loopRate = baseLoopRate * (dashReferenceCycle / resolvedPathLength);
      } else {
        loopRate = baseLoopRate * 0.25;
      }
    } else if (animationStyle === 'shimmer') {
      // For shimmer, use the cycle from pattern to calculate loopRate (slower = longer cycle)
      const shimmerCycle = pattern && Number.isFinite(Number(pattern.cycle)) ? Number(pattern.cycle) : 276;
      // Slower animation = lower loopRate, so divide by cycle ratio compared to default
      const defaultCycle = 110; // Original shimmer cycle
      loopRate = baseLoopRate * (defaultCycle / shimmerCycle); // 110/276 = ~0.4 (50% slower)
    }
    const baseDirection = flowState && typeof flowState.direction === 'number' && flowState.direction !== 0 ? Math.sign(flowState.direction) : 1;
    const elementDirectionMultiplier = (() => {
      // Optional SVG override:
      // - data-flow-dir="reverse" | "invert" | "-1"
      // - data-flow-direction="reverse" | ...
      // - data-flow-reverse="true"
      try {
        const raw = (
          (typeof element.getAttribute === 'function' ? element.getAttribute('data-flow-dir') : null)
          || (typeof element.getAttribute === 'function' ? element.getAttribute('data-flow-direction') : null)
          || (typeof element.getAttribute === 'function' ? element.getAttribute('data-flow-reverse') : null)
          || ''
        );
        const v = String(raw).trim().toLowerCase();
        if (!v) {
          return 1;
        }
        if (v === 'reverse' || v === 'invert' || v === 'true' || v === 'yes' || v === 'on' || v === '-1' || v === 'ccw') {
          return -1;
        }
        if (v === 'forward' || v === 'false' || v === 'no' || v === 'off' || v === '1' || v === 'cw') {
          return 1;
        }
        const n = Number(v);
        if (Number.isFinite(n) && n !== 0) {
          return n < 0 ? -1 : 1;
        }
      } catch (e) {
        // ignore
      }
      return 1;
    })();
    const effectiveDirection = baseDirection * elementDirectionMultiplier * directionSign;
    const isActive = seconds > 0;
    const isConfigStyled = (() => {
      try {
        const raw = element.getAttribute && element.getAttribute('data-style');
        return typeof raw === 'string' && raw.trim().toLowerCase() === 'config';
      } catch (e) {
        return false;
      }
    })();
    const shouldShow = isActive || isConfigStyled;
    const configuredFlowStrokeWidthPx = (() => {
      const v = Number(this._flowStrokeWidthPx);
      return Number.isFinite(v) ? v : null;
    })();
    const intrinsicFlowStrokeWidthPx = (() => {
      // Prefer the flow element's own stroke width (SVG attribute/CSS) so fluid_flow
      // respects per-flow widths unless a global override is set.
      try {
        const target = element && element.tagName === 'g'
          ? element.querySelector('path')
          : element;
        if (!target) {
          return null;
        }
        // Presentation attribute
        const attr = (typeof target.getAttribute === 'function') ? target.getAttribute('stroke-width') : null;
        const attrNum = attr !== null && attr !== undefined && String(attr).trim() !== '' ? Number(attr) : NaN;
        if (Number.isFinite(attrNum) && attrNum > 0) {
          return attrNum;
        }
        // Computed style
        if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
          const cs = window.getComputedStyle(target);
          const sw = cs && cs.strokeWidth ? String(cs.strokeWidth) : '';
          const parsed = sw ? parseFloat(sw) : NaN;
          if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
          }
        }
      } catch (e) {
        // ignore
      }
      return null;
    })();
    const fluidBaseWidthPx = (() => {
      const v = Number(this._fluidFlowStrokeWidthPx);
      if (Number.isFinite(v)) return v;
      if (configuredFlowStrokeWidthPx !== null) return configuredFlowStrokeWidthPx;
      if (intrinsicFlowStrokeWidthPx !== null) return intrinsicFlowStrokeWidthPx;
      return 5;
    })();
    const fluidWidths = {
      base: fluidBaseWidthPx,
      outer: fluidBaseWidthPx - 4,
      mid: fluidBaseWidthPx,
      inner: Math.max(0.5, fluidBaseWidthPx - 2),
      mask: fluidBaseWidthPx + 3
    };
    let entry = this._flowTweens.get(flowKey);

    if (entry && entry.mode !== animationStyle) {
      this._killFlowEntry(entry);
      this._flowTweens.delete(flowKey);
      entry = null;
    }

    const ensurePattern = () => {
      element.setAttribute('data-flow-style', animationStyle);
      // Phase A Optimization: Cache querySelectorAll result to avoid repeated DOM queries
      const targets = element.tagName === 'g' ? element.querySelectorAll('path') : [element];
      const isFluid = false;
      const isShimmer = animationStyle === 'shimmer';
      // Brighten and saturate color for phosphorescent effect - use same color for perimeter and fluid
      // For animated part, use even brighter color for maximum visibility
      const fluidBaseColor = isFluid ? this._brightenColor(strokeColor, 1.6, 1.7) : strokeColor;

      // Phase A Optimization: Skip expensive operations if not needed
      if (isFluid && this._debugFluidFlow) {
        try {
          const last = this._fluidFlowDebugColors ? this._fluidFlowDebugColors.get(flowKey) : undefined;
          if (last !== strokeColor) {
            this._fluidFlowDebugColors.set(flowKey, strokeColor);
          }
        } catch (e) {
          // ignore
        }
      }
      if (!isFluid) {
        this._removeFluidFlowOverlay(flowKey, element);
        this._removeFluidFlowMask(flowKey, element);
      }
      if (!isShimmer) {
        this._removeShimmerGradient(flowKey, element);
        this._removeShimmerOverlay(flowKey, element);
      }
      const overlay = isFluid ? this._ensureFluidFlowOverlay(flowKey, element) : null;
      const shimmerOverlay = isShimmer ? this._ensureShimmerOverlay(flowKey, element, strokeColor, effectiveDirection) : null;
      const maskInfo = (isFluid && pattern && pattern.dasharray)
        ? this._ensureFluidFlowMask(flowKey, element, pattern.dasharray, fluidWidths.mask)
        : (isFluid ? this._ensureFluidFlowMask(flowKey, element, '12 18', fluidWidths.mask) : null);

      // Phase A Optimization: Batch DOM updates for targets (reduces reflows)
      const targetUpdates = [];
      targets.forEach(target => {
        targetUpdates.push(() => {
          // Smooth corners and ends on polyline-like path segments
          target.style.strokeLinecap = 'round';
          target.style.strokeLinejoin = 'round';
        if (useArrows) {
            target.style.strokeDasharray = '';
            target.style.strokeDashoffset = '';
            target.style.strokeOpacity = '';
            if (!isFluid && configuredFlowStrokeWidthPx !== null) {
              target.style.strokeWidth = `${configuredFlowStrokeWidthPx}px`;
            }
        } else if (pattern && pattern.dasharray) {
            if (isFluid) {
              // Base "bed" (matches example's rgba(0,255,255,0.15)).
              target.style.strokeDasharray = '';
              target.style.strokeDashoffset = '';
              target.style.strokeOpacity = '0.15';
              target.style.strokeWidth = `${fluidWidths.base}px`;
            } else {
              target.style.strokeDasharray = pattern.dasharray;
              if (!target.style.strokeDashoffset) {
                target.style.strokeDashoffset = '0';
              }
              target.style.strokeOpacity = '';
              if (configuredFlowStrokeWidthPx !== null) {
                target.style.strokeWidth = `${configuredFlowStrokeWidthPx}px`;
              } else {
                target.style.strokeWidth = '';
              }
            }

            // Inkscape often uses marker-start/mid/end arrowheads which render as triangles.
            // When we're animating dashes/dots, those markers are unwanted, so strip them.
            target.removeAttribute('marker-start');
            target.removeAttribute('marker-mid');
            target.removeAttribute('marker-end');
            target.style.markerStart = '';
            target.style.markerMid = '';
            target.style.markerEnd = '';
          }
          // Use brightened color for both perimeter and fluid flow for consistency
          target.style.stroke = isFluid ? fluidBaseColor : strokeColor;
          // Reduce opacity of static part to make animated part more visible
          if (isFluid) {
            target.style.strokeOpacity = '0.2'; // Static part is much dimmer for better contrast
          }
          // For shimmer, set base color to white with low opacity (overlay handles the animated gradient with selected color)
          if (isShimmer) {
            // Base path with white and low opacity
            target.style.stroke = '#ffffff';
            target.style.strokeOpacity = '0.15';
            if (configuredFlowStrokeWidthPx !== null) {
              target.style.strokeWidth = `${configuredFlowStrokeWidthPx}px`;
            }
          }
        });
      });
      
      // Execute all target updates in a single batch (1 reflow instead of N)
      if (targetUpdates.length > 0) {
        requestAnimationFrame(() => {
          for (let i = 0; i < targetUpdates.length; i++) {
            targetUpdates[i]();
          }
        });
      }

      if (overlay && overlay.group && overlay.paths && overlay.paths.length) {
        overlay.group.setAttribute('data-flow-style', animationStyle);
        if (maskInfo && maskInfo.maskId) {
          overlay.group.setAttribute('mask', `url(#${maskInfo.maskId})`);
        } else {
          overlay.group.removeAttribute('mask');
        }
        overlay.group.style.opacity = isActive ? '1' : '0';
        overlay.paths.forEach((path) => {
          if (!path || !path.style) {
            return;
          }
          path.style.strokeLinecap = 'round';
          path.style.strokeLinejoin = 'round';
          const layer = (typeof path.getAttribute === 'function') ? (path.getAttribute('data-fluid-layer') || '') : '';
          // "Blue → white → blue" should be the pulse itself (not a separate white dash).
          // We get that by masking 3 stacked strokes with a blurred mask window:
          // - cyan haze
          // - cyan core
          // - white core
          // The mask's blur provides the ease-in/ease-out.

          if (layer === 'outer') {
            path.style.strokeWidth = `${fluidWidths.outer}px`;
            path.style.stroke = fluidBaseColor;
            path.style.strokeOpacity = this._fluidFlowOuterGlowEnabled ? '1.5' : '0'; // Increased from 1.2 for more contrast
          } else if (layer === 'mid') {
            path.style.strokeWidth = `${fluidWidths.mid}px`;
            path.style.stroke = fluidBaseColor;
            path.style.strokeOpacity = '2.0'; // Increased from 1.5 for more contrast
          } else {
            path.style.strokeWidth = `${fluidWidths.inner}px`;
            path.style.stroke = fluidBaseColor; // Use same color as perimeter for consistency
            path.style.strokeOpacity = '2.0'; // Increased from 1.5 for more contrast
          }
          path.style.fill = 'none';
          // The mask provides the moving pulse window and its easing.
          // Keep all overlay strokes solid; the blurred mask blends them into a cyan→white→cyan pulse.
          path.style.strokeDasharray = '';
          path.style.strokeDashoffset = '';
          path.removeAttribute('data-fluid-white-shift');
          path.removeAttribute('data-fluid-period');
          path.removeAttribute('marker-start');
          path.removeAttribute('marker-mid');
          path.removeAttribute('marker-end');
          path.style.markerStart = '';
          path.style.markerMid = '';
          path.style.markerEnd = '';
        });
      }
    };
    ensurePattern();

    if (element.tagName === 'g') {
      const paths = element.querySelectorAll('path');
      paths.forEach(path => path.style.opacity = shouldShow ? '1' : '0');
    } else {
      element.style.opacity = shouldShow ? '1' : '0';
    }

    if (useArrows && arrowShapes && arrowShapes.length) {
      arrowShapes.forEach((shape) => {
        if (shape.getAttribute('fill') !== strokeColor) {
          shape.setAttribute('fill', strokeColor);
        }
      });
    }

    const hideArrows = () => {
      if (arrowGroup) {
        arrowGroup.style.opacity = '0';
      }
      if (useArrows && arrowShapes && arrowShapes.length) {
        arrowShapes.forEach((shape) => shape.removeAttribute('transform'));
      }
    };

    // fluid_flow uses a dedicated rAF animator (mask dashoffset) so it keeps moving
    // even when GSAP isn't available or can't tick elements in <mask>/<defs> reliably.
    if (true) {
      this._stopFluidFlowRaf(flowKey);
    }

    if (!this._gsap) {
      if (entry) {
        this._killFlowEntry(entry);
        this._flowTweens.delete(flowKey);
      }
      this._setFlowGlow(element, strokeColor, isActive ? 1.5 : 0.5);
      if (false) {
        const overlay = this._ensureFluidFlowOverlay(flowKey, element);
        const maskInfo = this._ensureFluidFlowMask(flowKey, element, pattern && pattern.dasharray ? pattern.dasharray : '12 18', fluidWidths.mask);
        if (overlay && overlay.group && maskInfo && maskInfo.maskId) {
          overlay.group.setAttribute('mask', `url(#${maskInfo.maskId})`);
        }
        if (overlay && overlay.group) {
          overlay.group.setAttribute('data-flow-style', animationStyle);
          // Make animated part much more visible - increase opacity significantly
          overlay.group.style.opacity = isActive ? '2.5' : '0';
          // Increase glow intensity for animated part
          this._setFlowGlow(overlay.group, strokeColor, isActive ? 2.0 : 0.5);
        }
        if (overlay && overlay.paths && overlay.paths.length) {
          const fluidBaseColor = this._brightenColor(strokeColor, 1.6, 1.7);
          overlay.paths.forEach((path) => {
            if (path && path.style) {
              path.style.strokeDashoffset = '0';
              // Make animated paths much brighter
              path.style.opacity = isActive ? '2.5' : '0'; // Increased from 2.0 for more contrast
              // Update color to match current strokeColor
              const layer = (typeof path.getAttribute === 'function') ? (path.getAttribute('data-fluid-layer') || '') : '';
              if (layer === 'outer' || layer === 'mid' || layer === 'inner') {
                path.style.stroke = fluidBaseColor;
              }
            }
          });
        }

        // Drive the mask motion ourselves.
        this._setFluidFlowRaf(flowKey, {
          active: isActive,
          maskPaths: maskInfo && maskInfo.paths ? maskInfo.paths : [],
          maskId: maskInfo && maskInfo.maskId ? maskInfo.maskId : null,
          cycle: (pattern && Number.isFinite(Number(pattern.cycle))) ? Number(pattern.cycle) : 30,
          loopRate,
          direction: effectiveDirection
        });
      } else if (animationStyle === 'shimmer') {
        const shimmerOverlay = this._ensureShimmerOverlay(flowKey, element, strokeColor, effectiveDirection);
        if (shimmerOverlay && shimmerOverlay.group) {
          shimmerOverlay.group.style.opacity = isActive ? '1' : '0';
          // Apply stronger glow to shimmer overlay for more brightness
          this._setFlowGlow(shimmerOverlay.group, strokeColor, isActive ? 3.0 : 0.5);
        }
      }
      if (!useArrows) {
        if (element.tagName === 'g') {
          const paths = element.querySelectorAll('path');
          paths.forEach(path => path.style.strokeDashoffset = '0');
        } else {
        element.style.strokeDashoffset = '0';
        }
      }
      hideArrows();
      return;
    }

    if (!entry || entry.element !== element || entry.arrowElement !== arrowGroup) {
      if (entry) {
        this._killFlowEntry(entry);
      }

      const glowState = { value: isActive ? 0.8 : 0.25 };
      // For shimmer style, ALL flows should start phase at 0 to ensure they always start from the beginning
      // Also for battery and inverter flows regardless of style
      const shouldStartAtZero = animationStyle === 'shimmer' ? true : (flowKey === 'bat' || flowKey === 'inv1' || flowKey === 'inv2');
      // For shimmer flows, ALWAYS start at 0 regardless of active state, so when they become active they start from beginning
      // For other flows that should start at zero, only do so if active
      let initialPhase = (animationStyle === 'shimmer') ? 0 : ((shouldStartAtZero && isActive) ? 0 : Math.random());
      // CRITICAL: For shimmer flows, ALWAYS force phase to 0 regardless of any other conditions
      if (animationStyle === 'shimmer') {
        initialPhase = 0;
      }
      const motionState = { phase: initialPhase, distance: 0 };
      const directionState = { value: effectiveDirection };
      
      // For shimmer flows, ensure phase is always 0
      if (animationStyle === 'shimmer' && motionState.phase !== 0) {
        motionState.phase = 0;
      }
      
      const newEntry = {
        flowKey,
        element,
        glowState,
        color: strokeColor,
        tween: null,
        arrowElement: arrowGroup,
        arrowShapes: useArrows && arrowShapes ? arrowShapes : [],
        directionState,
        directionTween: null,
        motionState,
        tickerCallback: null,
        pathLength: resolvedPathLength,
        direction: effectiveDirection,
        mode: animationStyle,
        overlayGroup: null,
        overlayPaths: [],
        maskId: null,
        maskPaths: [],
        shimmerGradient: null,
        shimmerOverlay: null,
        shimmerWasActive: false, // Track if shimmer was active to detect activation - always start as false so first activation triggers reset
        shimmerLastDirection: undefined, // Track last direction to detect direction changes
        shimmerFirstTick: true, // Track if this is the first tick for shimmer - used to reset phase at first animation frame
        dashCycle: pattern && pattern.cycle ? pattern.cycle : 24,
        speedMagnitude,
        loopRate,
        arrowSpeedPx: baseLoopRate * dashReferenceCycle,
        active: isActive
      };

      if (false) {
        const overlay = this._ensureFluidFlowOverlay(flowKey, element);
        newEntry.overlayGroup = overlay.group;
        newEntry.overlayPaths = overlay.paths;
        if (newEntry.overlayGroup) {
          newEntry.overlayGroup.style.opacity = isActive ? '2.5' : '0';
        }
        const maskInfo = this._ensureFluidFlowMask(flowKey, element, pattern && pattern.dasharray ? pattern.dasharray : '12 18', fluidWidths.mask);
        newEntry.maskId = maskInfo.maskId;
        newEntry.maskPaths = maskInfo.paths;
        
        // Ensure overlay colors are set correctly (ensurePattern should have done this, but double-check)
        if (overlay && overlay.paths && overlay.paths.length) {
          const fluidBaseColor = this._brightenColor(strokeColor, 1.6, 1.7);
          overlay.paths.forEach((path) => {
            if (!path || !path.style) {
              return;
            }
            const layer = (typeof path.getAttribute === 'function') ? (path.getAttribute('data-fluid-layer') || '') : '';
            if (layer === 'outer' || layer === 'mid' || layer === 'inner') {
              path.style.stroke = fluidBaseColor;
            }
          });
        }
      } else if (animationStyle === 'shimmer') {
        const shimmerOverlay = this._ensureShimmerOverlay(flowKey, element, strokeColor, effectiveDirection);
        newEntry.shimmerOverlay = shimmerOverlay;
        newEntry.shimmerGradient = shimmerOverlay.gradient;
        // Initialize first tick flag for shimmer - will reset phase on first tick if active
        if (newEntry.shimmerFirstTick === undefined) {
          newEntry.shimmerFirstTick = isActive; // Set to true only if active, so first tick will reset phase
        }
        // CRITICAL: For shimmer flows, ALWAYS ensure phase starts at 0, regardless of active state
        // This ensures that when the flow becomes active, it starts from the beginning
        if (newEntry.motionState && newEntry.motionState.phase !== 0) {
          newEntry.motionState.phase = 0;
        }
      }
      if (false) {
        this._setFluidFlowRaf(flowKey, {
          active: isActive,
          maskPaths: newEntry.maskPaths,
          maskId: newEntry.maskId,
          cycle: (pattern && Number.isFinite(Number(pattern.cycle))) ? Number(pattern.cycle) : 30,
          loopRate,
          direction: effectiveDirection
        });
      }

      // For shimmer style, ALL flows should immediately update motion BEFORE adding to ticker
      // This ensures the gradient is positioned correctly from the start
      // Also for battery and inverter flows regardless of style
      const shouldUpdateImmediately = (animationStyle === 'shimmer' ? true : (flowKey === 'bat' || flowKey === 'inv1' || flowKey === 'inv2')) && isActive;
      if (shouldUpdateImmediately && newEntry.motionState) {
        // Ensure phase is 0 before updating motion
        newEntry.motionState.phase = 0;
        this._updateFlowMotion(newEntry);
      }

      newEntry.tickerCallback = this._createFlowTicker(newEntry);
      if (newEntry.tickerCallback) {
        this._gsap.ticker.add(newEntry.tickerCallback);
      }

      this._setFlowGlow(element, strokeColor, glowState.value);
      if (false && newEntry.overlayGroup) {
        // Increase glow intensity for animated part
        this._setFlowGlow(newEntry.overlayGroup, strokeColor, glowState.value * 1.3);
      }
      if (useArrows && arrowGroup) {
        const arrowVisible = isActive && loopRate > 0;
        arrowGroup.style.opacity = arrowVisible ? '1' : '0';
        this._setFlowGlow(arrowGroup, strokeColor, glowState.value);
        if (!arrowVisible && newEntry.arrowShapes && newEntry.arrowShapes.length) {
          newEntry.arrowShapes.forEach((shape) => shape.removeAttribute('transform'));
        }
      } else if (arrowGroup) {
        arrowGroup.style.opacity = '0';
      }

      this._updateFlowMotion(newEntry);

      const glowTween = this._gsap.to(glowState, {
        value: 1,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        duration: 1,
        onUpdate: () => {
          this._setFlowGlow(newEntry.element, newEntry.color, glowState.value);
          if (useArrows && newEntry.arrowElement) {
            this._setFlowGlow(newEntry.arrowElement, newEntry.color, glowState.value);
          }
          if (newEntry.mode === 'fluid_flow' && newEntry.overlayGroup) {
            // Increase glow intensity for animated part
            this._setFlowGlow(newEntry.overlayGroup, newEntry.color, glowState.value * 1.3);
          }
        }
      });
      newEntry.tween = glowTween;

      this._flowTweens.set(flowKey, newEntry);
      entry = newEntry;
    } else {
      entry.mode = animationStyle;
      entry.arrowShapes = useArrows && arrowShapes ? arrowShapes : [];
      entry.arrowElement = arrowGroup;
      entry.pathLength = resolvedPathLength;
      entry.dashCycle = pattern && pattern.cycle ? pattern.cycle : entry.dashCycle;
      entry.speedMagnitude = speedMagnitude;
      // loopRate is already calculated above for shimmer, just assign it
      entry.loopRate = loopRate;
      entry.arrowSpeedPx = baseLoopRate * dashReferenceCycle;
      entry.direction = effectiveDirection;
      // If active state changed, force re-sync to ensure animation starts/stops correctly
      const activeChanged = entry.active !== isActive;
      entry.active = isActive;
      // Force re-sync when active state changes to ensure flow visibility is updated
      if (activeChanged) {
        this._updateFlowMotion(entry);
      }
      if (false) {
        const overlay = this._ensureFluidFlowOverlay(flowKey, element);
        entry.overlayGroup = overlay.group;
        entry.overlayPaths = overlay.paths;
        if (entry.overlayGroup) {
          entry.overlayGroup.style.opacity = isActive ? '2.5' : '0';
        }
        const maskInfo = this._ensureFluidFlowMask(flowKey, element, pattern && pattern.dasharray ? pattern.dasharray : '12 18', fluidWidths.mask);
        entry.maskId = maskInfo.maskId;
        entry.maskPaths = maskInfo.paths;
        if (entry.overlayGroup && entry.maskId) {
          entry.overlayGroup.setAttribute('mask', `url(#${entry.maskId})`);
        }
        
        // Update overlay colors when style is updated (in case color changed)
        if (overlay && overlay.paths && overlay.paths.length) {
          const fluidBaseColor = this._brightenColor(strokeColor, 1.6, 1.7);
          overlay.paths.forEach((path) => {
            if (!path || !path.style) {
              return;
            }
            const layer = (typeof path.getAttribute === 'function') ? (path.getAttribute('data-fluid-layer') || '') : '';
            if (layer === 'outer' || layer === 'mid' || layer === 'inner') {
              path.style.stroke = fluidBaseColor;
            }
          });
        }

        this._setFluidFlowRaf(flowKey, {
          active: isActive,
          maskPaths: entry.maskPaths,
          maskId: entry.maskId,
          cycle: (pattern && Number.isFinite(Number(pattern.cycle))) ? Number(pattern.cycle) : 30,
          loopRate,
          direction: effectiveDirection
        });
      } else if (animationStyle === 'shimmer') {
        const shimmerOverlay = this._ensureShimmerOverlay(flowKey, element, strokeColor, effectiveDirection);
        entry.shimmerOverlay = shimmerOverlay;
        entry.shimmerGradient = shimmerOverlay.gradient;
        // Reset phase to 0 when shimmer becomes active OR when direction changes
        const directionChanged = entry.shimmerLastDirection !== undefined && entry.shimmerLastDirection !== effectiveDirection;
        // Reset phase when shimmer becomes active (transition from inactive to active), or when direction changes
        let phaseWasReset = false;
        const wasInactive = entry.shimmerWasActive === false || entry.shimmerWasActive === undefined;
        const justBecameActive = wasInactive && isActive;
        if (entry.motionState && isActive) {
          if (wasInactive || directionChanged) {
            entry.motionState.phase = 0;
            phaseWasReset = true;
          }
        }
        // If flow just became active, set shimmerFirstTick to true so first tick will also reset phase
        if (justBecameActive) {
          entry.shimmerFirstTick = true;
        }
        entry.shimmerWasActive = isActive;
        entry.shimmerLastDirection = effectiveDirection;
        entry.direction = effectiveDirection;
        // Immediately update motion to ensure gradient starts from the beginning
        if (phaseWasReset) {
          this._updateFlowMotion(entry);
        }
      } else if (entry.shimmerOverlay) {
        this._removeShimmerOverlay(flowKey, element);
        this._removeShimmerGradient(flowKey, element);
        entry.shimmerOverlay = null;
        entry.shimmerGradient = null;
      } else if (entry.overlayGroup || (entry.overlayPaths && entry.overlayPaths.length)) {
        this._removeFluidFlowOverlay(flowKey, element);
        this._removeFluidFlowMask(flowKey, element);
        entry.overlayGroup = null;
        entry.overlayPaths = [];
        entry.maskId = null;
        entry.maskPaths = [];
      }
      if (!entry.motionState) {
        // For shimmer style, ALL flows should start phase at 0 to ensure they always start from the beginning
        // Also for battery and inverter flows regardless of style
        const shouldStartAtZero = animationStyle === 'shimmer' ? true : (flowKey === 'bat' || flowKey === 'inv1' || flowKey === 'inv2');
        const initialPhase = (shouldStartAtZero && isActive) ? 0 : Math.random();
        entry.motionState = { phase: initialPhase, distance: 0 };
      } else {
        // For shimmer style, ALL flows should reset phase to 0 when path becomes active
        // Also for battery and inverter flows regardless of style
        const shouldResetPhase = animationStyle === 'shimmer' ? true : (flowKey === 'bat' || flowKey === 'inv1' || flowKey === 'inv2');
        let phaseWasReset = false;
        // Reset phase when flow becomes active (transition from inactive to active)
        // Also reset if shimmerWasActive is undefined (first time)
        // For shimmer, always reset phase to 0 when active to ensure it starts from beginning
        if (shouldResetPhase && isActive && entry.motionState) {
          const wasInactive = entry.shimmerWasActive === false || entry.shimmerWasActive === undefined;
          if (wasInactive) {
            entry.motionState.phase = 0;
            phaseWasReset = true;
          }
        }
        // Track shimmer active state for all flows when using shimmer style
        if (animationStyle === 'shimmer') {
          entry.shimmerWasActive = isActive;
        }
        // Immediately update motion to ensure flow starts from the beginning
        if (phaseWasReset) {
          this._updateFlowMotion(entry);
        }
      }
      if (typeof entry.motionState.distance !== 'number' || !Number.isFinite(entry.motionState.distance)) {
        entry.motionState.distance = 0;
      }
      if (!entry.directionState) {
        entry.directionState = { value: effectiveDirection };
      }
      if (!entry.tickerCallback) {
        entry.tickerCallback = this._createFlowTicker(entry);
        if (entry.tickerCallback) {
          this._gsap.ticker.add(entry.tickerCallback);
        }
      }
      if (entry.directionTween) {
        entry.directionTween.kill();
        entry.directionTween = null;
      }
      if (entry.directionState.value !== effectiveDirection) {
        entry.directionState.value = effectiveDirection;
        this._updateFlowMotion(entry);
      }
      if (useArrows && arrowGroup) {
        const arrowVisible = isActive && loopRate > 0;
        arrowGroup.style.opacity = arrowVisible ? '1' : '0';
        if (!arrowVisible && entry.arrowShapes && entry.arrowShapes.length) {
          entry.arrowShapes.forEach((shape) => shape.removeAttribute('transform'));
        }
      }
      this._updateFlowMotion(entry);
    }

    entry.color = strokeColor;

    if (!entry.directionState) {
      entry.directionState = { value: effectiveDirection };
    }

    if (!isActive) {
      entry.active = false;
      entry.speedMagnitude = 0;
      entry.loopRate = 0;
      if (entry.mode === 'fluid_flow') {
        this._setFluidFlowRaf(flowKey, {
          active: false,
          maskPaths: entry.maskPaths,
          maskId: entry.maskId,
          cycle: (pattern && Number.isFinite(Number(pattern.cycle))) ? Number(pattern.cycle) : 30,
          loopRate: 0,
          direction: effectiveDirection
        });
      }
      this._setFlowGlow(element, strokeColor, 0.25);
      if (entry.mode === 'fluid_flow' && entry.overlayGroup) {
        entry.overlayGroup.style.opacity = '0';
        this._setFlowGlow(entry.overlayGroup, strokeColor, 0.25);
        if (entry.overlayPaths && entry.overlayPaths.length) {
          entry.overlayPaths.forEach((path) => {
            if (path && path.style) {
              path.style.strokeDashoffset = '0';
              path.style.opacity = '0';
            }
          });
        }
      }
      if (entry.directionTween) {
        entry.directionTween.kill();
        entry.directionTween = null;
      }
      if (!useArrows) {
        if (element.tagName === 'g') {
          const paths = element.querySelectorAll('path');
          paths.forEach(path => path.style.strokeDashoffset = '0');
          paths.forEach(path => path.style.opacity = isActive ? '1' : '0');
        } else {
        element.style.strokeDashoffset = '0';
          element.style.opacity = isActive ? '1' : '0';
        }
      }
      hideArrows();
      if (entry.tween) {
        entry.tween.pause();
      }
      return;
    }

    entry.active = true;
    entry.speedMagnitude = speedMagnitude;
    entry.loopRate = loopRate;
    entry.arrowSpeedPx = baseLoopRate * dashReferenceCycle;
    if (useArrows) {
      if (loopRate === 0) {
        hideArrows();
      } else if (arrowGroup) {
        arrowGroup.style.opacity = '1';
      }
    }
    this._updateFlowMotion(entry);

    if (entry.tween) {
      if (speedMagnitude === 0 || loopRate === 0) {
        entry.tween.pause();
      } else {
        entry.tween.timeScale(Math.max(speedMagnitude, FLOW_MIN_GLOW_SCALE));
        entry.tween.play();
      }
    }
  }

  _setFlowGlow(element, color, intensity) {
    if (!element) {
      return;
    }
    const style = typeof element.getAttribute === 'function' ? (element.getAttribute('data-flow-style') || '') : '';
    // Glow is intentionally limited to a small set of styles.
    // (This makes "dashes" truly "no glow".)
    // Note: fluid_flow has its own layered pulse; disable outer glow for it.
    const allowFluidFlowGlow = style === 'fluid_flow' && Boolean(this._fluidFlowOuterGlowEnabled);
    if (style !== 'dashes_glow' && !allowFluidFlowGlow) {
      if (element.style) {
        element.style.filter = '';
        // Phase A Optimization: Remove will-change when not animating
        element.style.willChange = 'auto';
      }
      if (typeof element.removeAttribute === 'function') {
        element.removeAttribute('filter');
      }
      if (element.tagName === 'g') {
        const paths = element.querySelectorAll('path');
        paths.forEach((path) => {
          if (path && path.style) {
            path.style.filter = '';
            path.style.willChange = 'auto';
          }
          if (path && typeof path.removeAttribute === 'function') {
            path.removeAttribute('filter');
          }
        });
      }
      return;
    }
    let clamped = Math.min(Math.max(Number(intensity) || 0, 0), 1);
    // Increase glow intensity for fluid_flow
    if (style === 'fluid_flow') {
      clamped = Math.min(clamped * 1.5, 1.5); // Allow up to 1.5x intensity for fluid flow
    }
    // Increase color intensity for fluid_flow to make it more visible
    const innerAlpha = style === 'fluid_flow' ? (0.5 + 0.5 * clamped) : (0.35 + 0.45 * clamped);
    const outerAlpha = style === 'fluid_flow' ? (0.3 + 0.4 * clamped) : (0.2 + 0.3 * clamped);
    const inner = this._colorWithAlpha(color, innerAlpha);
    const outer = this._colorWithAlpha(color, outerAlpha);
    const glowSize = style === 'fluid_flow' ? 24 : 12; // Larger glow for fluid flow
    const outerGlowSize = style === 'fluid_flow' ? 36 : 18; // Larger outer glow for fluid flow
    element.style.filter = `drop-shadow(0 0 ${glowSize}px ${inner}) drop-shadow(0 0 ${outerGlowSize}px ${outer})`;
    // Phase A Optimization: Add will-change for animated elements (helps browser optimize)
    if (intensity > 0 && element.style) {
      element.style.willChange = 'filter, opacity';
    }
  }

  _brightenColor(color, brightness = 1.4, saturation = 1.5) {
    // Phase A Optimization: Cache color conversions
    const cacheKey = `${color}-${brightness}-${saturation}`;
    if (this._colorCache && this._colorCache.has(cacheKey)) {
      return this._colorCache.get(cacheKey);
    }
    
    // Convert color to RGB, increase brightness and saturation for phosphorescent effect
    if (!color) {
      color = '#00FFFF'; // Default cyan
    }
    
    // Handle hex colors
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const fullHex = hex.length === 3
        ? hex.split('').map((c) => c + c).join('')
        : hex.padEnd(6, '0');
      const r = parseInt(fullHex.slice(0, 2), 16);
      const g = parseInt(fullHex.slice(2, 4), 16);
      const b = parseInt(fullHex.slice(4, 6), 16);
      
      // Convert RGB to HSL for easier manipulation
      const rNorm = r / 255;
      const gNorm = g / 255;
      const bNorm = b / 255;
      
      const max = Math.max(rNorm, gNorm, bNorm);
      const min = Math.min(rNorm, gNorm, bNorm);
      let h, s, l = (max + min) / 2;
      
      if (max === min) {
        h = s = 0; // achromatic
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case rNorm: h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6; break;
          case gNorm: h = ((bNorm - rNorm) / d + 2) / 6; break;
          case bNorm: h = ((rNorm - gNorm) / d + 4) / 6; break;
        }
      }
      
      // Increase saturation and lightness for phosphorescent effect
      s = Math.min(1, s * saturation);
      l = Math.min(0.95, l * brightness);
      
      // Convert HSL back to RGB
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs((h * 6) % 2 - 1));
      const m = l - c / 2;
      let rNew, gNew, bNew;
      
      if (h < 1/6) {
        rNew = c; gNew = x; bNew = 0;
      } else if (h < 2/6) {
        rNew = x; gNew = c; bNew = 0;
      } else if (h < 3/6) {
        rNew = 0; gNew = c; bNew = x;
      } else if (h < 4/6) {
        rNew = 0; gNew = x; bNew = c;
      } else if (h < 5/6) {
        rNew = x; gNew = 0; bNew = c;
      } else {
        rNew = c; gNew = 0; bNew = x;
      }
      
      rNew = Math.round((rNew + m) * 255);
      gNew = Math.round((gNew + m) * 255);
      bNew = Math.round((bNew + m) * 255);
      
      const result = `rgb(${rNew}, ${gNew}, ${bNew})`;
      // Phase A Optimization: Cache the result
      if (this._colorCache) {
        this._colorCache.set(cacheKey, result);
      }
      return result;
    }
    
    // Handle rgb/rgba colors
    const match = color.match(/rgba?\(([^)]+)\)/i);
    if (match) {
      const parts = match[1].split(',').map((part) => part.trim());
      const r = parseInt(parts[0], 10);
      const g = parseInt(parts[1], 10);
      const b = parseInt(parts[2], 10);
      
      // Convert RGB to HSL
      const rNorm = r / 255;
      const gNorm = g / 255;
      const bNorm = b / 255;
      
      const max = Math.max(rNorm, gNorm, bNorm);
      const min = Math.min(rNorm, gNorm, bNorm);
      let h, s, l = (max + min) / 2;
      
      if (max === min) {
        h = s = 0;
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case rNorm: h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6; break;
          case gNorm: h = ((bNorm - rNorm) / d + 2) / 6; break;
          case bNorm: h = ((rNorm - gNorm) / d + 4) / 6; break;
        }
      }
      
      // Increase saturation and lightness
      s = Math.min(1, s * saturation);
      l = Math.min(0.95, l * brightness);
      
      // Convert HSL back to RGB
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs((h * 6) % 2 - 1));
      const m = l - c / 2;
      let rNew, gNew, bNew;
      
      if (h < 1/6) {
        rNew = c; gNew = x; bNew = 0;
      } else if (h < 2/6) {
        rNew = x; gNew = c; bNew = 0;
      } else if (h < 3/6) {
        rNew = 0; gNew = c; bNew = x;
      } else if (h < 4/6) {
        rNew = 0; gNew = x; bNew = c;
      } else if (h < 5/6) {
        rNew = x; gNew = 0; bNew = c;
      } else {
        rNew = c; gNew = 0; bNew = x;
      }
      
      rNew = Math.round((rNew + m) * 255);
      gNew = Math.round((gNew + m) * 255);
      bNew = Math.round((bNew + m) * 255);
      
      const result = `rgb(${rNew}, ${gNew}, ${bNew})`;
      // Phase A Optimization: Cache the result
      if (this._colorCache) {
        this._colorCache.set(cacheKey, result);
      }
      return result;
    }
    
    // Return as-is if format not recognized (also cache it)
    if (this._colorCache) {
      this._colorCache.set(cacheKey, color);
    }
    return color;
  }

  _colorWithAlpha(color, alpha) {
    if (!color) {
      return `rgba(0, 255, 255, ${alpha})`;
    }
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const fullHex = hex.length === 3
        ? hex.split('').map((c) => c + c).join('')
        : hex.padEnd(6, '0');
      const r = parseInt(fullHex.slice(0, 2), 16);
      const g = parseInt(fullHex.slice(2, 4), 16);
      const b = parseInt(fullHex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    const match = color.match(/rgba?\(([^)]+)\)/i);
    if (match) {
      const parts = match[1].split(',').map((part) => part.trim());
      const [r, g, b] = parts;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
  }

  _computeFlowLoopRate(magnitude) {
    if (!Number.isFinite(magnitude) || magnitude <= 0) {
      return 0;
    }
    return magnitude * FLOW_BASE_LOOP_RATE;
  }

  _killFlowEntry(entry) {
    if (!entry) {
      return;
    }
    try {
      this._stopFluidFlowRaf(entry.flowKey);
    } catch (e) {
      // ignore
    }
    if (entry.mode === 'fluid_flow') {
      try {
        this._removeFluidFlowMask(entry.flowKey, entry.element);
      } catch (e) {
        // ignore
      }
    }
    if (entry.tween) {
      entry.tween.kill();
    }
    if (entry.directionTween) {
      entry.directionTween.kill();
    }
    if (entry.tickerCallback && this._gsap && this._gsap.ticker) {
      this._gsap.ticker.remove(entry.tickerCallback);
    }
    if (entry.motionState) {
      entry.motionState.phase = 0;
    }
    if (entry.element && entry.mode && entry.mode !== 'arrows') {
      entry.element.style.strokeDashoffset = '0';
    }
    if (entry.arrowElement) {
      entry.arrowElement.style.opacity = '0';
      entry.arrowElement.removeAttribute('transform');
    }
    if (entry.arrowShapes && entry.arrowShapes.length) {
      entry.arrowShapes.forEach((shape) => shape.removeAttribute('transform'));
    }
    entry.speedMagnitude = 0;
    entry.loopRate = 0;
  }

  _getFlowPathLength(flowKey) {
    if (this._flowPathLengths && this._flowPathLengths.has(flowKey)) {
      return this._flowPathLengths.get(flowKey);
    }
    const paths = this._domRefs && this._domRefs.flows ? this._domRefs.flows : null;
    const element = paths ? paths[flowKey] : null;
    if (!element || typeof element.getTotalLength !== 'function') {
      return 0;
    }
    const length = element.getTotalLength();
    if (!this._flowPathLengths) {
      this._flowPathLengths = new Map();
    }
    this._flowPathLengths.set(flowKey, length);
    return length;
  }

  _positionArrow(entry, progress, shape) {
    if (!entry || !shape || !entry.element || typeof entry.element.getPointAtLength !== 'function') {
      return;
    }
    const length = entry.pathLength || this._getFlowPathLength(entry.flowKey);
    if (!Number.isFinite(length) || length <= 0) {
      return;
    }
    const normalized = ((progress % 1) + 1) % 1;
    const distance = normalized * length;
    const point = entry.element.getPointAtLength(distance);
    const ahead = entry.element.getPointAtLength(Math.min(distance + 2, length));
    const angle = Math.atan2(ahead.y - point.y, ahead.x - point.x) * (180 / Math.PI);
    const directionValue = entry.directionState && Number.isFinite(entry.directionState.value)
      ? entry.directionState.value
      : (entry.direction || 1);
    const flip = directionValue < 0 ? 180 : 0;
    shape.setAttribute('transform', `translate(${point.x}, ${point.y}) rotate(${angle + flip})`);
  }

  _updateFlowMotion(entry) {
    if (!entry || !entry.element) {
      return;
    }
    const motionState = entry.motionState;
    if (!motionState) {
      return;
    }
    // Phase A Optimization: Add will-change for animated elements (helps browser optimize)
    if (entry.element && entry.element.style && entry.active) {
      entry.element.style.willChange = 'stroke-dashoffset, transform, opacity';
    }
    if (entry.arrowElement && entry.arrowElement.style && entry.active) {
      entry.arrowElement.style.willChange = 'transform, opacity';
    }
    
    const phase = Number(motionState.phase) || 0;
    if (entry.mode === 'arrows' && entry.arrowShapes && entry.arrowShapes.length) {
      const count = entry.arrowShapes.length;
      const normalized = ((phase % 1) + 1) % 1;
      const directionValue = entry.directionState && Number.isFinite(entry.directionState.value)
        ? entry.directionState.value
        : (entry.direction || 1);
      const directionSign = directionValue >= 0 ? 1 : -1;
      entry.arrowShapes.forEach((shape, index) => {
        // Phase A Optimization: Add will-change for animated arrows
        if (entry.active && shape && shape.style) {
          shape.style.willChange = 'transform';
        }
        const offset = directionSign >= 0
          ? normalized + index / count
          : normalized - index / count;
        this._positionArrow(entry, offset, shape);
      });
    } else if (entry.mode === 'fluid_flow') {
      // fluid_flow is animated via a dedicated rAF loop.
      // This method is still called for consistency, but the actual animation
      // happens in _setFluidFlowRaf's requestAnimationFrame callback.
      const cycle = entry.dashCycle || 24;
      const offset = -phase * cycle;
      const maskTargets = entry.maskPaths && entry.maskPaths.length ? entry.maskPaths : [];
      if (maskTargets.length) {
        maskTargets.forEach((path) => {
          if (path && path.style) {
            // Phase A Optimization: Add will-change for animated paths
            if (entry.active) {
              path.style.willChange = 'stroke-dashoffset';
            }
            const shiftRaw = (typeof path.getAttribute === 'function') ? path.getAttribute('data-fluid-mask-shift') : null;
            const shift = shiftRaw !== null && shiftRaw !== undefined ? Number(shiftRaw) : 0;
            const applied = Number.isFinite(shift) ? (offset + shift * cycle) : offset;
            path.style.strokeDashoffset = `${applied}`;
          }
        });
      } else if (entry.overlayPaths && entry.overlayPaths.length) {
        // Fallback for older entries created before mask support.
        entry.overlayPaths.forEach((path) => {
          if (path && path.style) {
            // Phase A Optimization: Add will-change for animated paths
            if (entry.active) {
              path.style.willChange = 'stroke-dashoffset';
            }
            path.style.strokeDashoffset = `${offset}`;
          }
        });
      }
    } else if (entry.mode === 'shimmer') {
      const shimmerOverlay = entry.shimmerOverlay;
      if (shimmerOverlay && shimmerOverlay.group) {
        const maskAttr = shimmerOverlay.group.getAttribute('mask');
        if (maskAttr) {
          const maskId = maskAttr.replace(/url\(#(.+)\)/, '$1');
          const svgRoot = entry.element.ownerSVGElement;
                  if (svgRoot) {
            const escapeFn = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape : (v) => v;
            const maskPath = svgRoot.querySelector(`#${escapeFn(maskId)} path`);
            if (maskPath) {
              const normalizedPhase = phase % 1;
              // Animate dash offset to make it follow the path sequentially
              // We use negative offset to move the dash forward
              // Add slight variation to dasharray for wave/ripple effect
              const waveOffset = Math.sin(normalizedPhase * Math.PI * 4) * 2; // Subtle wave effect
              maskPath.style.strokeDashoffset = (100 - normalizedPhase * 100 + waveOffset).toString();
            }
          }
        }
        // Update opacity based on active state to hide shimmer when flow is off
        const desiredOpacity = entry.active ? '1' : '0';
        if (shimmerOverlay.group.style.opacity !== desiredOpacity) {
          shimmerOverlay.group.style.opacity = desiredOpacity;
        }
        
        // Add pulsing glow effect based on phase for more dynamic shimmer
        if (entry.active && shimmerOverlay.paths && shimmerOverlay.paths.length) {
          const normalizedPhase = phase % 1;
          // Create a pulsing effect: glow intensity varies from 2.5 to 4.0 based on position
          // This creates a breathing/pulsing effect as the shimmer moves
          const pulseIntensity = 2.5 + Math.sin(normalizedPhase * Math.PI * 2) * 0.75; // Varies between 2.5 and 3.25
          // Get color from entry or fallback to strokeColor from element
          const glowColor = entry.color || (entry.element && entry.element.getAttribute ? entry.element.getAttribute('stroke') : null) || '#00ffff';
          this._setFlowGlow(shimmerOverlay.group, glowColor, pulseIntensity);
          
          // Animate trail layers with different opacities for depth effect
          shimmerOverlay.paths.forEach((path) => {
            if (!path || !path.getAttribute) return;
            // Phase A Optimization: Add will-change for animated shimmer paths
            if (entry.active && path.style) {
              path.style.willChange = 'opacity';
            }
            const layer = path.getAttribute('data-shimmer-layer');
            if (layer === 'trail-1') {
              // Outer trail: subtle pulse with phase offset
              const trail1Opacity = 0.2 + Math.sin(normalizedPhase * Math.PI * 2 + Math.PI / 3) * 0.15;
              path.style.opacity = Math.max(0, Math.min(1, trail1Opacity)).toString();
            } else if (layer === 'trail-2') {
              // Mid trail: moderate pulse with phase offset
              const trail2Opacity = 0.4 + Math.sin(normalizedPhase * Math.PI * 2 + Math.PI / 6) * 0.2;
              path.style.opacity = Math.max(0, Math.min(1, trail2Opacity)).toString();
            } else if (layer === 'highlight') {
              // Highlight: strong pulse for sparkle effect
              const highlightOpacity = 0.7 + Math.sin(normalizedPhase * Math.PI * 2) * 0.3;
              path.style.opacity = Math.max(0, Math.min(1, highlightOpacity)).toString();
            }
          });
        }
      }
    } else if (entry.mode !== 'arrows') {
      const cycle = entry.dashCycle || 24;
      const offset = -phase * cycle;
      if (entry.element.tagName === 'g') {
        const paths = entry.element.querySelectorAll('path');
        paths.forEach(path => path.style.strokeDashoffset = `${offset}`);
      } else {
      entry.element.style.strokeDashoffset = `${offset}`;
      }
    }
  }

  _createFlowTicker(entry) {
    if (!this._gsap || !this._gsap.ticker) {
      return null;
    }
    // fluid_flow is animated via a dedicated rAF loop.
    if (entry && entry.mode === 'fluid_flow') {
      return null;
    }
    return (time, deltaTime) => {
      if (!entry || !entry.active) {
        return;
      }
      const loopRate = entry.loopRate || 0;
      if (loopRate === 0) {
        return;
      }
      const directionValue = entry.directionState && Number.isFinite(entry.directionState.value)
        ? entry.directionState.value
        : (entry.direction || 0);
      if (directionValue === 0) {
        return;
      }
      const delta = deltaTime * loopRate * directionValue;
      if (!Number.isFinite(delta) || delta === 0) {
        return;
      }
      if (!entry.motionState) {
        entry.motionState = { phase: 0, distance: 0 };
      }
      if (typeof entry.motionState.distance !== 'number' || !Number.isFinite(entry.motionState.distance)) {
        entry.motionState.distance = 0;
      }
      
      // For shimmer style, ALL flows should reset phase to 0 when path becomes active OR when direction changes
      // Also for battery and inverter flows regardless of style
      const currentDirection = entry.directionState && Number.isFinite(entry.directionState.value)
        ? entry.directionState.value
        : (entry.direction || 0);
      const shouldResetPhase = entry.mode === 'shimmer' ? true : (entry.flowKey === 'bat' || entry.flowKey === 'inv1' || entry.flowKey === 'inv2');
      const directionChanged = shouldResetPhase && entry.shimmerLastDirection !== undefined && entry.shimmerLastDirection !== currentDirection;
      let phaseWasReset = false;
      
      // NEW APPROACH: For shimmer, reset phase on first tick when active
      // This ensures phase starts at 0 even if entry was created when already active
      if (entry.mode === 'shimmer' && entry.active && entry.motionState) {
        if (entry.shimmerFirstTick !== undefined && entry.shimmerFirstTick) {
          entry.motionState.phase = 0;
          entry.shimmerFirstTick = false;
          phaseWasReset = true;
        }
      }
      
      // Reset phase when flow becomes active (for all shimmer flows, battery, and inverter)
      // Also reset if shimmerWasActive is undefined (first time)
      if (shouldResetPhase && entry.active && entry.motionState && !phaseWasReset) {
        const wasInactive = entry.shimmerWasActive === false || entry.shimmerWasActive === undefined;
        if (wasInactive) {
          entry.motionState.phase = 0;
          phaseWasReset = true;
        }
      } else if (shouldResetPhase && directionChanged && entry.motionState) {
        entry.motionState.phase = 0;
        phaseWasReset = true;
      }
      
      if (entry.mode === 'shimmer' && entry.active && entry.motionState) {
        entry.motionState.phase = (Number(entry.motionState.phase) || 0) + delta;
      } else {
        entry.motionState.phase = (Number(entry.motionState.phase) || 0) + delta;
      }
      // Track active state for shimmer flows and reset flows
      if (shouldResetPhase) {
        entry.shimmerWasActive = entry.active;
        entry.shimmerLastDirection = currentDirection;
      }
      
      // Phase update is already done above for shimmer flows (with debug logging)
      // For non-shimmer flows, update phase here if not reset
      if (!phaseWasReset && entry.mode !== 'shimmer') {
        entry.motionState.phase = (Number(entry.motionState.phase) || 0) + delta;
      }
      
      // If phase was reset, update motion immediately to ensure gradient starts from beginning
      if (phaseWasReset) {
        this._updateFlowMotion(entry);
        return; // Skip normal update since we just updated
      }
      if (!Number.isFinite(entry.motionState.phase)) {
        entry.motionState.phase = 0;
      } else if (entry.motionState.phase > 1000 || entry.motionState.phase < -1000) {
        entry.motionState.phase = entry.motionState.phase % 1;
      }
      this._updateFlowMotion(entry);
    };
  }

  _teardownFlowAnimations() {
    if (!this._flowTweens) {
      return;
    }
    this._flowTweens.forEach((entry) => {
      this._killFlowEntry(entry);
    });
    this._flowTweens.clear();
    if (this._fluidFlowRafs && this._fluidFlowRafs.size) {
      Array.from(this._fluidFlowRafs.keys()).forEach((key) => {
        try {
          this._stopFluidFlowRaf(key);
        } catch (e) {
          // ignore
        }
      });
      this._fluidFlowRafs.clear();
    }
  }

  _normalizeAnimationStyle(style) {
    const normalized = typeof style === 'string' ? style.trim().toLowerCase() : '';
    if (normalized && Object.prototype.hasOwnProperty.call(FLOW_STYLE_PATTERNS, normalized)) {
      return normalized;
    }
    return FLOW_STYLE_DEFAULT;
  }

  _getFlowGeometryPaths(element) {
    if (!element) {
      return [];
    }
    if (typeof element.getTotalLength === 'function') {
      return [element];
    }
    if (element.tagName === 'g') {
      return Array.from(element.querySelectorAll('path')).filter((p) => typeof p.getTotalLength === 'function');
    }
    return [];
  }

  _ensureFluidFlowOverlay(flowKey, element) {
    if (!flowKey || !element) {
      return { group: null, paths: [] };
    }
    const ns = 'http://www.w3.org/2000/svg';
    const container = element.tagName === 'g' ? element : element.parentNode;
    if (!container || typeof container.querySelector !== 'function') {
      return { group: null, paths: [] };
    }

    const key = String(flowKey);
    const escapeFn = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape : (v) => v;
    let group = null;
    try {
      group = container.querySelector(`[data-fluid-flow-overlay="${escapeFn(key)}"]`);
    } catch (e) {
      group = container.querySelector(`[data-fluid-flow-overlay="${key}"]`);
    }

    if (!group) {
      group = document.createElementNS(ns, 'g');
      group.setAttribute('data-fluid-flow-overlay', key);
      group.style.pointerEvents = 'none';
      group.style.opacity = '0';

      const geometry = this._getFlowGeometryPaths(element);
      geometry.forEach((path, index) => {
        try {
          const makeClone = (layer) => {
            const clone = path.cloneNode(true);
            clone.removeAttribute('id');
            clone.removeAttribute('class');
            clone.removeAttribute('data-flow-key');
            clone.removeAttribute('data-arrow-key');
            clone.removeAttribute('data-arrow-shape');
            clone.setAttribute('data-fluid-path', String(index));
            clone.setAttribute('data-fluid-layer', layer);
            clone.setAttribute('fill', 'none');
            return clone;
          };

          // 3-layer highlight (cyan haze + cyan core + white heart)
          group.appendChild(makeClone('outer'));
          group.appendChild(makeClone('mid'));
          group.appendChild(makeClone('inner'));
        } catch (err) {
          // ignore
        }
      });

      container.appendChild(group);
    }

    return { group, paths: Array.from(group.querySelectorAll('path')) };
  }

  _removeFluidFlowOverlay(flowKey, element) {
    if (!flowKey || !element) {
      return;
    }
    const container = element.tagName === 'g' ? element : element.parentNode;
    if (!container || typeof container.querySelector !== 'function') {
      return;
    }
    const key = String(flowKey);
    const escapeFn = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape : (v) => v;
    let group = null;
    try {
      group = container.querySelector(`[data-fluid-flow-overlay="${escapeFn(key)}"]`);
    } catch (e) {
      group = container.querySelector(`[data-fluid-flow-overlay="${key}"]`);
    }
    if (group && typeof group.remove === 'function') {
      group.remove();
    } else if (group && group.parentNode) {
      group.parentNode.removeChild(group);
    }
  }

  _ensureFluidFlowMask(flowKey, element, dasharray, maskStrokeWidthPx) {
    if (!flowKey || !element) {
      return { maskId: null, paths: [] };
    }
    const svgRoot = element.ownerSVGElement || null;
    if (!svgRoot || typeof svgRoot.querySelector !== 'function') {
      return { maskId: null, paths: [] };
    }
    const ns = 'http://www.w3.org/2000/svg';
    const key = String(flowKey).replace(/[^a-z0-9_-]/gi, '_');
    const escapeFn = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape : (v) => v;
    const defs = (() => {
      let d = svgRoot.querySelector('defs');
      if (!d) {
        d = document.createElementNS(ns, 'defs');
        svgRoot.insertBefore(d, svgRoot.firstChild);
      }
      return d;
    })();

    const filterId = `lumina-fluid-mask-blur-${key}`;
    let filterEl = null;
    try {
      filterEl = defs.querySelector(`#${escapeFn(filterId)}`);
    } catch (e) {
      filterEl = defs.querySelector(`#${filterId}`);
    }
    if (!filterEl) {
      filterEl = document.createElementNS(ns, 'filter');
      filterEl.setAttribute('id', filterId);
      filterEl.setAttribute('x', '-50%');
      filterEl.setAttribute('y', '-50%');
      filterEl.setAttribute('width', '200%');
      filterEl.setAttribute('height', '200%');
      filterEl.setAttribute('color-interpolation-filters', 'sRGB');
      const blur = document.createElementNS(ns, 'feGaussianBlur');
      blur.setAttribute('stdDeviation', '8');
      filterEl.appendChild(blur);
      defs.appendChild(filterEl);
    }

    const maskId = `lumina-fluid-mask-${key}`;
    let maskEl = null;
    try {
      maskEl = defs.querySelector(`#${escapeFn(maskId)}`);
    } catch (e) {
      maskEl = defs.querySelector(`#${maskId}`);
    }

    const resolvedDash = dasharray || '12 18';
    const resolvedWidth = Number.isFinite(Number(maskStrokeWidthPx)) ? Number(maskStrokeWidthPx) : 8;

    try {
      if (maskEl) {
        const geometry = this._getFlowGeometryPaths(element);
        const desired = (geometry && geometry.length) ? geometry.length * 2 : 0;
        const existing = maskEl.querySelectorAll('[data-fluid-mask-path]');
        if (desired && existing && existing.length && existing.length < desired) {
          if (typeof maskEl.remove === 'function') {
            maskEl.remove();
          } else if (maskEl.parentNode) {
            maskEl.parentNode.removeChild(maskEl);
          }
          maskEl = null;
        }
      }
    } catch (e) {
      // ignore
    }
    if (!maskEl) {
      maskEl = document.createElementNS(ns, 'mask');
      maskEl.setAttribute('id', maskId);
      maskEl.setAttribute('maskUnits', 'userSpaceOnUse');
      maskEl.setAttribute('maskContentUnits', 'userSpaceOnUse');

      const g = document.createElementNS(ns, 'g');
      g.setAttribute('data-fluid-mask-group', key);
      g.setAttribute('filter', `url(#${filterId})`);

      const geometry = this._getFlowGeometryPaths(element);
      geometry.forEach((path, index) => {
        try {
          const makeClone = (shift) => {
            const clone = path.cloneNode(true);
            clone.removeAttribute('id');
            clone.removeAttribute('class');
            clone.removeAttribute('data-flow-key');
            clone.removeAttribute('data-arrow-key');
            clone.removeAttribute('data-arrow-shape');
            clone.setAttribute('data-fluid-mask-path', String(index));
            clone.setAttribute('data-fluid-mask-shift', String(shift));
            clone.setAttribute('fill', 'none');
            clone.style.stroke = '#ffffff';
            clone.style.strokeOpacity = '1';
            clone.style.strokeWidth = `${resolvedWidth}px`;
            clone.style.strokeLinecap = 'round';
            clone.style.strokeLinejoin = 'round';
            clone.style.strokeDasharray = resolvedDash;
            clone.style.strokeDashoffset = '0';
            return clone;
          };

          // Two windows, half-cycle apart.
          g.appendChild(makeClone(0));
          g.appendChild(makeClone(0.5));
        } catch (err) {
          // ignore
        }
      });

      maskEl.appendChild(g);
      defs.appendChild(maskEl);

    }

    const maskPaths = Array.from(maskEl.querySelectorAll('[data-fluid-mask-path]'));
    maskPaths.forEach((p) => {
      try {
        p.style.strokeDasharray = resolvedDash;
        p.style.strokeWidth = `${resolvedWidth}px`;
      } catch (e) {
        // ignore
      }
    });

    return { maskId, paths: maskPaths };
  }

  _ensureShimmerGradient(flowKey, element, strokeColor) {
    if (!flowKey || !element) {
      return { gradientId: null, linearGradient: null };
    }
    const ns = 'http://www.w3.org/2000/svg';
    const svgRoot = element.ownerSVGElement || null;
    if (!svgRoot || typeof svgRoot.querySelector !== 'function') {
      return { gradientId: null, linearGradient: null };
    }
    let defs = svgRoot.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS(ns, 'defs');
      svgRoot.insertBefore(defs, svgRoot.firstChild);
    }

    const key = String(flowKey).replace(/[^a-z0-9_-]/gi, '_');
    const escapeFn = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape : (v) => v;
    const gradientId = `lumina-shimmer-gradient-${key}`;
    let linearGradient = null;
    try {
      linearGradient = defs.querySelector(`#${escapeFn(gradientId)}`);
    } catch (e) {
      linearGradient = defs.querySelector(`#${gradientId}`);
    }

    if (!linearGradient) {
      linearGradient = document.createElementNS(ns, 'linearGradient');
      linearGradient.setAttribute('id', gradientId);
      // Use objectBoundingBox so coordinates are relative to path bounding box (0-1 range)
      linearGradient.setAttribute('gradientUnits', 'objectBoundingBox');
      // Gradient goes horizontally along the path (left to right)
      // We'll animate x1 and x2 to create the sliding effect
      linearGradient.setAttribute('x1', '0');
      linearGradient.setAttribute('x2', '1');
      linearGradient.setAttribute('y1', '0');
      linearGradient.setAttribute('y2', '0');
      linearGradient.setAttribute('spreadMethod', 'pad');

      // Create enhanced gradient stops for richer shimmer effect
      // More stops create smoother transitions and a more vibrant appearance
      const stops = [
        { offset: '0%', color: 'transparent' },
        { offset: '15%', color: this._colorWithAlpha(strokeColor, 0.2) },
        { offset: '30%', color: this._colorWithAlpha(strokeColor, 0.5) },
        { offset: '42%', color: this._colorWithAlpha(strokeColor, 0.8) },
        { offset: '48%', color: strokeColor },
        { offset: '50%', color: '#ffffff' }, // Bright white center
        { offset: '52%', color: strokeColor },
        { offset: '58%', color: this._colorWithAlpha(strokeColor, 0.8) },
        { offset: '70%', color: this._colorWithAlpha(strokeColor, 0.5) },
        { offset: '85%', color: this._colorWithAlpha(strokeColor, 0.2) },
        { offset: '100%', color: 'transparent' }
      ];

      stops.forEach(stop => {
        const stopEl = document.createElementNS(ns, 'stop');
        stopEl.setAttribute('offset', stop.offset);
        if (stop.color === 'transparent') {
          stopEl.setAttribute('stop-color', strokeColor);
          stopEl.setAttribute('stop-opacity', '0');
        } else {
          const rgbMatch = stop.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
          if (rgbMatch) {
            stopEl.setAttribute('stop-color', `rgb(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]})`);
            stopEl.setAttribute('stop-opacity', rgbMatch[4] || '1');
          } else {
            stopEl.setAttribute('stop-color', stop.color);
            stopEl.setAttribute('stop-opacity', '1');
          }
        }
        linearGradient.appendChild(stopEl);
      });

      defs.appendChild(linearGradient);
    }

    return { gradientId, linearGradient };
  }

  _removeShimmerGradient(flowKey, element) {
    if (!flowKey || !element) {
      return;
    }
    const svgRoot = element.ownerSVGElement || null;
    if (!svgRoot || typeof svgRoot.querySelector !== 'function') {
      return;
    }
    const defs = svgRoot.querySelector('defs');
    if (!defs) {
      return;
    }
    const key = String(flowKey).replace(/[^a-z0-9_-]/gi, '_');
    const escapeFn = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape : (v) => v;
    const gradientId = `lumina-shimmer-gradient-${key}`;
    let gradientEl = null;
    try {
      gradientEl = defs.querySelector(`#${escapeFn(gradientId)}`);
    } catch (e) {
      gradientEl = defs.querySelector(`#${gradientId}`);
    }
    if (gradientEl && typeof gradientEl.remove === 'function') {
      gradientEl.remove();
    } else if (gradientEl && gradientEl.parentNode) {
      gradientEl.parentNode.removeChild(gradientEl);
    }
  }

  _ensureShimmerOverlay(flowKey, element, strokeColor, direction = 1) {
    if (!flowKey || !element) {
      return { group: null, paths: [], gradient: null };
    }
    const ns = 'http://www.w3.org/2000/svg';
    const container = element.tagName === 'g' ? element : element.parentNode;
    if (!container || typeof container.querySelector !== 'function') {
      return { group: null, paths: [], gradient: null };
    }

    const key = String(flowKey);
    const escapeFn = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape : (v) => v;
    let group = null;
    try {
      group = container.querySelector(`[data-shimmer-overlay="${escapeFn(key)}"]`);
    } catch (e) {
      group = container.querySelector(`[data-shimmer-overlay="${key}"]`);
    }

    if (!group) {
      group = document.createElementNS(ns, 'g');
      group.setAttribute('data-shimmer-overlay', key);
      group.style.pointerEvents = 'none';
      group.style.opacity = '0';

      const svgRoot = element.ownerSVGElement;
      if (svgRoot) {
        let defs = svgRoot.querySelector('defs');
        if (!defs) {
          defs = document.createElementNS(ns, 'defs');
          svgRoot.insertBefore(defs, svgRoot.firstChild);
        }
        
        const maskId = `lumina-shimmer-mask-${key.replace(/[^a-z0-9_-]/gi, '_')}`;
        let mask = defs.querySelector(`#${escapeFn(maskId)}`);
        if (mask) mask.remove(); // Force recreate for new path data

        mask = document.createElementNS(ns, 'mask');
        mask.setAttribute('id', maskId);
        
        const maskPath = document.createElementNS(ns, 'path');
        maskPath.setAttribute('d', element.getAttribute('d'));
        maskPath.setAttribute('fill', 'none');
        maskPath.setAttribute('stroke', 'white');
        maskPath.setAttribute('stroke-width', '25'); // Increased for more visible trail effect
        maskPath.setAttribute('stroke-linecap', 'round');
        maskPath.setAttribute('pathLength', '100');
        // Shimmer dash: 17.5% visible, 82.5% gap - luce accorciata della metà (era 35/65)
        maskPath.setAttribute('stroke-dasharray', '17.5 82.5');
        maskPath.setAttribute('stroke-dashoffset', '100');
        
        const filterId = `lumina-shimmer-blur-${key.replace(/[^a-z0-9_-]/gi, '_')}`;
        let filter = defs.querySelector(`#${escapeFn(filterId)}`);
        if (!filter) {
          filter = document.createElementNS(ns, 'filter');
          filter.setAttribute('id', filterId);
          filter.setAttribute('x', '-50%');
          filter.setAttribute('y', '-50%');
          filter.setAttribute('width', '200%');
          filter.setAttribute('height', '200%');
          filter.setAttribute('color-interpolation-filters', 'sRGB');
          
          // Add glow effect using feGaussianBlur and feColorMatrix
          const blur = document.createElementNS(ns, 'feGaussianBlur');
          blur.setAttribute('in', 'SourceGraphic');
          blur.setAttribute('stdDeviation', '6'); // Increased blur for a brighter, more glowing shimmer effect
          blur.setAttribute('result', 'blur');
          filter.appendChild(blur);
          
          // Add color matrix to enhance the glow
          const colorMatrix = document.createElementNS(ns, 'feColorMatrix');
          colorMatrix.setAttribute('in', 'blur');
          colorMatrix.setAttribute('type', 'matrix');
          colorMatrix.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1.5 0'); // Increase alpha for brighter glow
          colorMatrix.setAttribute('result', 'coloredBlur');
          filter.appendChild(colorMatrix);
          
          // Merge original and blurred for composite effect
          const merge = document.createElementNS(ns, 'feMerge');
          const mergeNode1 = document.createElementNS(ns, 'feMergeNode');
          mergeNode1.setAttribute('in', 'coloredBlur');
          merge.appendChild(mergeNode1);
          const mergeNode2 = document.createElementNS(ns, 'feMergeNode');
          mergeNode2.setAttribute('in', 'SourceGraphic');
          merge.appendChild(mergeNode2);
          filter.appendChild(merge);
          
          defs.appendChild(filter);
        }
        maskPath.setAttribute('filter', `url(#${filterId})`);
        
        mask.appendChild(maskPath);
        defs.appendChild(mask);
        group.setAttribute('mask', `url(#${maskId})`);
      }

      const geometry = this._getFlowGeometryPaths(element);
      geometry.forEach((path) => {
        try {
          const clone = path.cloneNode(true);
          clone.removeAttribute('id');
          clone.removeAttribute('class');
          clone.removeAttribute('data-flow-key');
          clone.removeAttribute('data-direction');
          clone.removeAttribute('data-arrow-key');
          clone.removeAttribute('data-arrow-shape');
          clone.setAttribute('fill', 'none');
          clone.setAttribute('stroke', strokeColor);
          
          const originalPathLength = path.getAttribute('pathLength');
          clone.setAttribute('pathLength', originalPathLength || '100');
          
          clone.style.strokeLinecap = 'round';
          clone.style.strokeLinejoin = 'round';
          
          // Use same stroke width as base path
          const basePath = element.tagName === 'g' ? element.querySelector('path') : element;
          if (basePath && basePath.style.strokeWidth) {
            clone.style.strokeWidth = basePath.style.strokeWidth;
          }
          
          group.appendChild(clone);
          
          // Add trail layers for a more interesting shimmer effect (creating a glowing trail)
          // Trail layer 1: outer glow (most transparent)
          const trail1 = clone.cloneNode(true);
          trail1.setAttribute('stroke', strokeColor);
          trail1.style.strokeWidth = parseFloat(clone.style.strokeWidth || 2) * 1.4 + 'px';
          trail1.style.opacity = '0.3';
          trail1.setAttribute('data-shimmer-layer', 'trail-1');
          group.appendChild(trail1);
          
          // Trail layer 2: mid glow
          const trail2 = clone.cloneNode(true);
          trail2.setAttribute('stroke', strokeColor);
          trail2.style.strokeWidth = parseFloat(clone.style.strokeWidth || 2) * 1.1 + 'px';
          trail2.style.opacity = '0.5';
          trail2.setAttribute('data-shimmer-layer', 'trail-2');
          group.appendChild(trail2);
          
          // Add a colored core for the shimmer effect (using the selected color instead of white)
          const core = clone.cloneNode(true);
          core.setAttribute('stroke', strokeColor);
          core.style.strokeWidth = parseFloat(clone.style.strokeWidth || 2) * 0.6 + 'px';
          core.style.opacity = '1.0'; // Increased opacity for more brightness
          core.setAttribute('data-shimmer-layer', 'core');
          group.appendChild(core);
          
          // Add bright white highlight at the center for extra sparkle
          const highlight = clone.cloneNode(true);
          highlight.setAttribute('stroke', '#ffffff');
          highlight.style.strokeWidth = parseFloat(clone.style.strokeWidth || 2) * 0.3 + 'px';
          highlight.style.opacity = '0.9';
          highlight.setAttribute('data-shimmer-layer', 'highlight');
          group.appendChild(highlight);
          
        } catch (err) { }
      });

      container.appendChild(group);
    }

    const paths = Array.from(group.querySelectorAll('path'));
    // Store paths reference for animation effects
    return { group, paths, gradient: null, color: strokeColor };
  }

  _sanitizePath(pathData) {
    if (!pathData || typeof pathData !== 'string') return '';
    // Trim whitespace
    let sanitized = pathData.trim();
    if (!sanitized) return '';
    
    // Replace commas with spaces (SVG allows both, but we normalize to spaces)
    sanitized = sanitized.replace(/,/g, ' ');
    
    // Remove any trailing dashes or invalid characters that might cause parsing errors
    sanitized = sanitized.replace(/[-\s]+$/, '').trim();
    
    // Remove leading/trailing whitespace and normalize spaces
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    
    // Check if path starts with M or m (moveto command)
    if (!/^[Mm]/.test(sanitized)) {
      // If it doesn't start with M, try to fix it
      // Common case: user entered just coordinates like "250 237 L 282 230"
      // We'll prepend "M " to make it valid
      sanitized = 'M ' + sanitized;
    }
    
    // Ensure path is valid by checking it has at least M command
    if (!/^[Mm]/.test(sanitized)) {
      // If still invalid, return empty string to fall back to default
      return '';
    }
    
    // Normalize the path: split by commands and rebuild
    // Handle cases like "M 480 310 630 350 720 310" -> "M 480 310 L 630 350 L 720 310"
    const commandChars = 'MmLlHhVvCcSsQqTtAaZz';
    const parts = [];
    let currentIndex = 0;
    
    // Find all commands and their positions
    const commandRegex = new RegExp(`([${commandChars}])\\s*`, 'g');
    let match;
    const commands = [];
    
    while ((match = commandRegex.exec(sanitized)) !== null) {
      commands.push({
        index: match.index,
        command: match[1],
        length: match[0].length
      });
    }
    
    // Rebuild the path
    let normalized = '';
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      const nextCmd = commands[i + 1];
      const coordsStart = cmd.index + cmd.length;
      const coordsEnd = nextCmd ? nextCmd.index : sanitized.length;
      const coords = sanitized.substring(coordsStart, coordsEnd).trim();
      
      // Add the command (uppercase M for first command)
      if (i === 0 && cmd.command.toLowerCase() === 'm') {
        normalized += 'M ';
      } else {
        normalized += cmd.command + ' ';
      }
      
      // Add coordinates
      if (coords) {
        normalized += coords;
      }
      
      // If next command exists and is not L/l, and we have coordinates, check if we need L
      if (nextCmd && coords) {
        const nextCmdLower = nextCmd.command.toLowerCase();
        // If the next command is M (new path) or another non-line command after coordinates, 
        // and we have multiple coordinate pairs, we might need to add L
        // But actually, SVG allows implicit L after M, so this might not be necessary
        // The real issue is when user enters "M 480 310 630 350" without L
        // SVG interprets this as "M 480 310 L 630 350" implicitly, but some parsers might be strict
      }
    }
    
    // Special handling: if path is just "M" followed by multiple coordinate pairs without L commands,
    // add L commands explicitly for better compatibility
    // Pattern: "M x1 y1 x2 y2 x3 y3" -> "M x1 y1 L x2 y2 L x3 y3"
    const simplePathMatch = normalized.match(/^([Mm])\s+((?:[-\d.]+\s+[-\d.]+\s*)+)$/);
    if (simplePathMatch) {
      const coordString = simplePathMatch[2].trim();
      const coordArray = coordString.split(/\s+/).filter(c => c && c !== '-'); // Filter out empty strings and standalone dashes
      if (coordArray.length > 2 && coordArray.length % 2 === 0) {
        // Multiple coordinate pairs, add L commands
        let result = 'M ' + coordArray[0] + ' ' + coordArray[1];
        for (let i = 2; i < coordArray.length; i += 2) {
          if (i + 1 < coordArray.length) {
            result += ' L ' + coordArray[i] + ' ' + coordArray[i + 1];
          }
        }
        normalized = result;
      }
    }
    
    // Clean up multiple spaces and remove any trailing invalid characters
    sanitized = normalized.replace(/\s+/g, ' ').trim();
    // Remove any trailing dashes, commas, or other invalid characters
    sanitized = sanitized.replace(/[-\s,]+$/, '').trim();
    
    // Final validation: ensure the path is valid SVG
    // Check that it starts with M and contains only valid SVG path characters
    if (!/^[Mm]/.test(sanitized)) {
      return '';
    }
    
    return sanitized;
  }

  _reversePath(pathData) {
    if (!pathData) return '';
    // Normalize path data: replace commas with spaces and trim
    const normalized = pathData.replace(/,/g, ' ').trim();
    // Extract all numbers
    const numbers = normalized.match(/[-+]?[\d.]+/g);
    if (!numbers || numbers.length < 4) return pathData;

    // Check if it's a simple M x1 y1 L x2 y2 path (most common)
    if (numbers.length === 4 && /^M\s*[-+]?[\d.]+\s*[-+]?[\d.]+\s*L\s*[-+]?[\d.]+\s*[-+]?[\d.]+$/i.test(normalized)) {
      return `M ${numbers[2]} ${numbers[3]} L ${numbers[0]} ${numbers[1]}`;
    }

    // For multi-point paths, reverse the pairs of coordinates
    const points = [];
    for (let i = 0; i < numbers.length; i += 2) {
      if (i + 1 < numbers.length) {
        points.push(`${numbers[i]} ${numbers[i + 1]}`);
      }
    }
    
    if (points.length > 1) {
      const reversedPoints = points.reverse();
      let reversedPath = `M ${reversedPoints[0]}`;
      for (let i = 1; i < reversedPoints.length; i++) {
        reversedPath += ` L ${reversedPoints[i]}`;
      }
      return reversedPath;
    }

    return pathData;
  }

  _removeShimmerOverlay(flowKey, element) {
    if (!flowKey || !element) {
      return;
    }
    const container = element.tagName === 'g' ? element : element.parentNode;
    if (!container || typeof container.querySelector !== 'function') {
      return;
    }
    const key = String(flowKey);
    const escapeFn = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape : (v) => v;
    let group = null;
    try {
      group = container.querySelector(`[data-shimmer-overlay="${escapeFn(key)}"]`);
    } catch (e) {
      group = container.querySelector(`[data-shimmer-overlay="${key}"]`);
    }
    if (group && typeof group.remove === 'function') {
      group.remove();
    } else if (group && group.parentNode) {
      group.parentNode.removeChild(group);
    }
  }

  _removeFluidFlowMask(flowKey, element) {
    if (!flowKey || !element) {
      return;
    }
    const svgRoot = element.ownerSVGElement || null;
    if (!svgRoot || typeof svgRoot.querySelector !== 'function') {
      return;
    }
    const defs = svgRoot.querySelector('defs');
    if (!defs) {
      return;
    }
    const key = String(flowKey).replace(/[^a-z0-9_-]/gi, '_');
    const escapeFn = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape : (v) => v;
    const maskId = `lumina-fluid-mask-${key}`;
    let maskEl = null;
    try {
      maskEl = defs.querySelector(`#${escapeFn(maskId)}`);
    } catch (e) {
      maskEl = defs.querySelector(`#${maskId}`);
    }
    if (maskEl && typeof maskEl.remove === 'function') {
      maskEl.remove();
    } else if (maskEl && maskEl.parentNode) {
      maskEl.parentNode.removeChild(maskEl);
    }
    const filterId = `lumina-fluid-mask-blur-${key}`;
    let filterEl = null;
    try {
      filterEl = defs.querySelector(`#${escapeFn(filterId)}`);
    } catch (e) {
      filterEl = defs.querySelector(`#${filterId}`);
    }
    if (filterEl && typeof filterEl.remove === 'function') {
      filterEl.remove();
    } else if (filterEl && filterEl.parentNode) {
      filterEl.parentNode.removeChild(filterEl);
    }
  }

  _stopFluidFlowRaf(flowKey) {
    if (!flowKey || !this._fluidFlowRafs) {
      return;
    }
    const key = String(flowKey);
    const state = this._fluidFlowRafs.get(key);
    if (!state) {
      return;
    }
    if (state.rafId) {
      try {
        cancelAnimationFrame(state.rafId);
      } catch (e) {
        // ignore
      }
    }

    this._fluidFlowRafs.delete(key);
  }

  _setFluidFlowRaf(flowKey, opts) {
    if (!flowKey) {
      return;
    }
    if (!this._fluidFlowRafs) {
      this._fluidFlowRafs = new Map();
    }
    const key = String(flowKey);
    const active = Boolean(opts && opts.active);
    const maskPaths = (opts && opts.maskPaths && Array.isArray(opts.maskPaths)) ? opts.maskPaths : [];
    const cycle = (opts && Number.isFinite(Number(opts.cycle))) ? Number(opts.cycle) : 30;
    const loopRate = (opts && Number.isFinite(Number(opts.loopRate))) ? Number(opts.loopRate) : 0;
    const direction = (opts && Number.isFinite(Number(opts.direction))) ? Number(opts.direction) : 0;
    const maskId = (opts && typeof opts.maskId === 'string' && opts.maskId) ? opts.maskId : null;

    // Only stop if truly inactive - allow animation to run even with low loopRate to ensure smooth transitions
    if (!active || !maskPaths.length) {
      this._stopFluidFlowRaf(key);
      return;
    }
    
    // Ensure minimum loopRate and direction for animation to work
    const effectiveLoopRate = loopRate === 0 ? 0.001 : loopRate; // Small minimum to keep animation alive
    const effectiveDirection = direction === 0 ? 1 : direction; // Default to forward if direction is 0

    let state = this._fluidFlowRafs.get(key);
    if (!state) {
      state = {
        rafId: null,
        lastTs: null,
        phase: Math.random(),
        maskPaths: [],
        cycle,
        loopRate,
        direction,
        maskId,
        didLogStart: false,
        didLogFirstTick: false
      };
      this._fluidFlowRafs.set(key, state);
    }

    state.maskPaths = maskPaths;
    state.cycle = cycle;
    state.loopRate = effectiveLoopRate;
    state.direction = effectiveDirection;
    state.maskId = maskId;

    try {
      if (this._fluidFlowDebugStopLog) {
        this._fluidFlowDebugStopLog.delete(key);
      }
    } catch (e) {
      // ignore
    }

    if (this._debugFluidFlow && !state.didLogStart) {
      state.didLogStart = true;
    }

    const tick = (ts) => {
      const s = this._fluidFlowRafs.get(key);
      if (!s) {
        return;
      }
      if (s.lastTs === null || s.lastTs === undefined) {
        s.lastTs = ts;
      }
      const deltaMs = Number(ts) - Number(s.lastTs);
      s.lastTs = ts;
      if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
        s.rafId = requestAnimationFrame(tick);
        return;
      }

      // Use effective loopRate and direction from state
      const effectiveLoopRate = s.loopRate || 0.001;
      const effectiveDirection = s.direction || 1;
      s.phase = (Number(s.phase) || 0) + (deltaMs * effectiveLoopRate * (effectiveDirection >= 0 ? 1 : -1));
      if (!Number.isFinite(s.phase)) {
        s.phase = 0;
      }
      const offset = -(s.phase * s.cycle);

      const targets = s.maskPaths || [];
      targets.forEach((path) => {
        if (!path || !path.style) {
          return;
        }
        const shiftRaw = (typeof path.getAttribute === 'function') ? path.getAttribute('data-fluid-mask-shift') : null;
        const shift = shiftRaw !== null && shiftRaw !== undefined ? Number(shiftRaw) : 0;
        const applied = Number.isFinite(shift) ? (offset + shift * s.cycle) : offset;
        path.style.strokeDashoffset = `${applied}`;
      });

      if (this._debugFluidFlow && !s.didLogFirstTick) {
        s.didLogFirstTick = true;
      }

      s.rafId = requestAnimationFrame(tick);
    };

    if (!state.rafId) {
      state.lastTs = null;
      state.rafId = requestAnimationFrame(tick);
    }
  }

  getStateSafe(entity_id) {
    // Phase A Optimization: Memoization with cache
    if (!entity_id || !this._hass || !this._hass.states) {
      return 0;
    }
    
    // Check cache first (if hass version hasn't changed)
    const hassVersion = this._hass.version || Date.now();
    if (this._lastHassVersion === hassVersion && this._stateCache.has(entity_id)) {
      const cached = this._stateCache.get(entity_id);
      const now = Date.now();
      if (now - cached.time < this._stateCacheTimeout) {
        return cached.value; // Return cached value
      }
      // Cache expired, remove it
      this._stateCache.delete(entity_id);
    }
    
    // Update hass version tracker
    if (this._lastHassVersion !== hassVersion) {
      this._stateCache.clear(); // Clear cache on hass change
      this._lastHassVersion = hassVersion;
    }
    
    // Original logic
    if (!this._hass.states[entity_id] ||
        this._hass.states[entity_id].state === 'unavailable' ||
        this._hass.states[entity_id].state === 'unknown') {
      return 0;
    }

    let value = parseFloat(this._hass.states[entity_id].state);
    // Ensure we return a valid number, not NaN
    if (!Number.isFinite(value)) {
      return 0;
    }
    
    const unit = this._hass.states[entity_id].attributes?.unit_of_measurement;

    // Optimized: cache toLowerCase result
    if (unit) {
      const unitLower = unit.toLowerCase();
      if (unitLower === 'kw' || unitLower === 'kwh') {
        value = value * 1000;
      }
    }

    // Double check after unit conversion
    const finalValue = Number.isFinite(value) ? value : 0;
    
    // Cache the result
    this._stateCache.set(entity_id, {
      value: finalValue,
      time: Date.now()
    });
    
    return finalValue;
  }

  getEntityName(entity_id) {
    if (!entity_id || !this._hass.states[entity_id]) {
      return entity_id || 'Unknown';
    }
    return this._hass.states[entity_id].attributes.friendly_name || entity_id;
  }

  formatPower(watts, use_kw) {
    if (use_kw) {
      return (watts / 1000).toFixed(2) + ' kW';
    }
    return Math.round(watts) + ' W';
  }

  formatPopupValue(_unused, sensorId) {
    if (!sensorId || !this._hass || !this._hass.states) {
      return '';
    }
    // Optimized: cache trim result
    const resolvedId = typeof sensorId === 'string' ? sensorId.trim() : sensorId;
    if (!resolvedId || !this._hass.states[resolvedId]) {
      return '';
    }
    const entity = this._hass.states[resolvedId];
    if (!entity || entity.state === undefined || entity.state === null) {
      return '';
    }
    // Optimized: cache toString and trim
    const rawState = entity.state.toString().trim();
    if (!rawState) {
      return '';
    }
    // Optimized: cache toLowerCase
    const lowerState = rawState.toLowerCase();
    if (lowerState === 'unknown' || lowerState === 'unavailable') {
      return rawState;
    }
    // Optimized: cache trim on unit
    const unitAttr = entity.attributes && entity.attributes.unit_of_measurement;
    const unit = (typeof unitAttr === 'string') ? unitAttr.trim() : '';
    return unit ? `${rawState} ${unit}` : rawState;
  }

  _getHouseTotLabel(language) {
    const labels = {
      en: 'HOUSE TOT',
      it: 'TOTALE CASA',
      de: 'HAUS GESAMT',
      fr: 'TOTAL MAISON',
      nl: 'HUIS TOTAAL'
    };
    return labels[language] || labels.en;
  }

  _isEntityControllable(entityId) {
    if (!entityId || typeof entityId !== 'string' || !entityId.trim()) {
      return false;
    }
    const trimmedId = entityId.trim();
    const domain = trimmedId.split('.')[0];
    if (!domain) {
      return false;
    }
    // Domains that can be controlled via toggle
    const controllableDomains = ['light', 'switch', 'input_boolean', 'fan', 'climate', 'cover', 'lock', 'media_player', 'scene', 'script'];
    // Check if domain is controllable (don't require entity to exist in hass.states yet)
    if (controllableDomains.includes(domain)) {
      return true;
    }
    // Also check if entity exists and is controllable
    if (this._hass && this._hass.states && this._hass.states[trimmedId]) {
      return controllableDomains.includes(domain);
    }
    return false;
  }

  _getEntityDomain(entityId) {
    if (!entityId || typeof entityId !== 'string') {
      return null;
    }
    const parts = entityId.split('.');
    return parts.length > 0 ? parts[0] : null;
  }

  _updateToggleSwitch(toggle, entityId) {
    if (!toggle || !entityId) return;
    const entity = this._hass && this._hass.states && this._hass.states[entityId];
    if (!entity) return;
    
    const state = (entity.state || '').toLowerCase();
    const isOn = state === 'on' || state === 'open' || state === 'unlocked';
    
    this._updateToggleSwitchVisual(toggle, isOn);
  }

  _updateToggleSwitchOptimistic(toggle, isOn) {
    if (!toggle) return;
    this._updateToggleSwitchVisual(toggle, isOn);
  }

  _updateToggleSwitchVisual(toggle, isOn) {
    if (!toggle) return;
    
    // Update toggle switch appearance
    const bgRect = toggle.querySelector('rect');
    const sliderCircle = toggle.querySelector('circle');
    if (bgRect) {
      bgRect.setAttribute('fill', isOn ? '#4CAF50' : '#444');
      bgRect.setAttribute('stroke', '#00FFFF');
      bgRect.setAttribute('stroke-width', '1.5');
      bgRect.setAttribute('opacity', '0.3');
      bgRect.style.stroke = '#00FFFF';
      bgRect.style.opacity = '0.3';
    }
    if (sliderCircle) {
      sliderCircle.setAttribute('cx', isOn ? '10' : '-10');
      sliderCircle.setAttribute('fill', '#fff');
      sliderCircle.setAttribute('opacity', '0.9');
      sliderCircle.style.opacity = '0.9';
    }
  }

  async _toggleEntity(entityId) {
    if (!entityId || !this._hass || !this._hass.callService) {
      return;
    }
    if (!this._hass.states || !this._hass.states[entityId]) {
      return;
    }

    const entity = this._hass.states[entityId];
    const domain = this._getEntityDomain(entityId);
    const currentState = (entity.state || '').toLowerCase();

    try {
      if (domain === 'light') {
        const service = currentState === 'on' ? 'turn_off' : 'turn_on';
        await this._hass.callService('light', service, { entity_id: entityId });
      } else if (domain === 'switch') {
        const service = currentState === 'on' ? 'turn_off' : 'turn_on';
        await this._hass.callService('switch', service, { entity_id: entityId });
      } else if (domain === 'input_boolean') {
        const service = currentState === 'on' ? 'turn_off' : 'turn_on';
        await this._hass.callService('input_boolean', service, { entity_id: entityId });
      } else if (domain === 'fan') {
        const service = currentState === 'on' ? 'turn_off' : 'turn_on';
        await this._hass.callService('fan', service, { entity_id: entityId });
      } else if (domain === 'cover') {
        const service = currentState === 'open' ? 'close_cover' : 'open_cover';
        await this._hass.callService('cover', service, { entity_id: entityId });
      } else if (domain === 'lock') {
        const service = currentState === 'locked' ? 'unlock' : 'lock';
        await this._hass.callService('lock', service, { entity_id: entityId });
      } else if (domain === 'scene') {
        await this._hass.callService('scene', 'turn_on', { entity_id: entityId });
      } else if (domain === 'script') {
        await this._hass.callService('script', 'turn_on', { entity_id: entityId });
      } else {
      }
      
      // Update toggle switches immediately after a short delay to allow state to propagate
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        this._updateAllToggleSwitches();
        // Also update after state propagation (Zigbee devices may take longer)
        setTimeout(() => {
          this._updateAllToggleSwitches();
        }, 300);
        setTimeout(() => {
          this._updateAllToggleSwitches();
        }, 800);
      });
    } catch (error) {
      // Handle different types of errors more gracefully
      const errorMessage = error?.message || String(error);
      const errorCode = error?.code;
      
      // Check for Zigbee/network errors
      if (errorCode === 'home_assistant_error' || errorMessage.includes('MAC_NO_ACK') || errorMessage.includes('Failed to send request')) {
        // Still try to update toggle switches in case state changed
        setTimeout(() => {
          this._updateAllToggleSwitches();
        }, 500);
      }
    }
  }

  _updateTemperatureOdometer(odometerGroup, currentValue, previousValue) {
    if (!odometerGroup || currentValue === null || currentValue === undefined) {
      return;
    }

    // Format temperature value: round to 1 decimal place
    const formatted = Number(currentValue).toFixed(1);
    const digits = formatted.split('');
    const digitWidth = 10; // Width per digit
    const digitHeight = 16; // Height for digit container
    const fontSize = 14;
    const fillColor = '#00FFFF';

    // Get or create digit elements
    let digitElements = Array.from(odometerGroup.children)
      .filter(child => child.getAttribute && child.getAttribute('data-role') && child.getAttribute('data-role').startsWith('temp-digit-'))
      .map((group, index) => {
        const textGroup = group.querySelector('g[clip-path]');
        const clipPathId = textGroup ? textGroup.getAttribute('clip-path') : null;
        const clipId = clipPathId ? clipPathId.replace('url(#', '').replace(')', '') : null;
        return { group, textGroup: textGroup || null, clipId };
      });
    
    // If number of digits changed, recreate all
    if (digitElements.length !== digits.length) {
      // Remove old digit elements
      digitElements.forEach(el => {
        if (el && el.group && el.group.parentNode) {
          el.group.remove();
        }
      });
      digitElements = [];
      
      // Create defs if needed
      let defs = odometerGroup.querySelector('defs');
      if (!defs) {
        defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        odometerGroup.insertBefore(defs, odometerGroup.firstChild);
      }
      
      digits.forEach((_, index) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('data-role', `temp-digit-${index}`);
        g.setAttribute('transform', `translate(${index * digitWidth}, 0)`);
        g.setAttribute('style', 'overflow: hidden;');
        
        // Create clip path for scrolling effect
        const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clipPath.setAttribute('id', `temp-clip-${Date.now()}-${index}`);
        const clipId = clipPath.getAttribute('id');
        const clipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        clipRect.setAttribute('width', digitWidth);
        clipRect.setAttribute('height', digitHeight);
        clipPath.appendChild(clipRect);
        defs.appendChild(clipPath);
        
        const textGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        textGroup.setAttribute('clip-path', `url(#${clipId})`);
        g.appendChild(textGroup);
        odometerGroup.appendChild(g);
        digitElements.push({ group: g, textGroup, clipId });
      });
    } else {
      // Ensure existing elements have the correct structure
      digitElements = digitElements.map((digitEl, index) => {
        if (!digitEl || !digitEl.group) {
          // Recreate this digit element
          const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          g.setAttribute('data-role', `temp-digit-${index}`);
          g.setAttribute('transform', `translate(${index * digitWidth}, 0)`);
          g.setAttribute('style', 'overflow: hidden;');
          
          let defs = odometerGroup.querySelector('defs');
          if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            odometerGroup.insertBefore(defs, odometerGroup.firstChild);
          }
          
          const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
          clipPath.setAttribute('id', `temp-clip-${Date.now()}-${index}`);
          const clipId = clipPath.getAttribute('id');
          const clipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          clipRect.setAttribute('width', digitWidth);
          clipRect.setAttribute('height', digitHeight);
          clipPath.appendChild(clipRect);
          defs.appendChild(clipPath);
          
          const textGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          textGroup.setAttribute('clip-path', `url(#${clipId})`);
          g.appendChild(textGroup);
          odometerGroup.appendChild(g);
          return { group: g, textGroup, clipId };
        }
        
        // Ensure textGroup exists
        if (!digitEl.textGroup) {
          let textGroup = digitEl.group.querySelector('g[clip-path]');
          if (!textGroup) {
            let defs = odometerGroup.querySelector('defs');
            if (!defs) {
              defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
              odometerGroup.insertBefore(defs, odometerGroup.firstChild);
            }
            
            const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
            clipPath.setAttribute('id', `temp-clip-${Date.now()}-${index}`);
            const clipId = clipPath.getAttribute('id');
            const clipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            clipRect.setAttribute('width', digitWidth);
            clipRect.setAttribute('height', digitHeight);
            clipPath.appendChild(clipRect);
            defs.appendChild(clipPath);
            
            textGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            textGroup.setAttribute('clip-path', `url(#${clipId})`);
            digitEl.group.appendChild(textGroup);
            digitEl.clipId = clipId;
          }
          digitEl.textGroup = textGroup;
        }
        
        return digitEl;
      });
    }

    // Update each digit with animation
    digits.forEach((digit, index) => {
      const digitEl = digitElements[index];
      if (!digitEl) return;

      if (!digitEl.group) return;
      
      let textGroup = digitEl.textGroup;
      if (!textGroup) {
        textGroup = digitEl.group.querySelector('g[clip-path]');
        if (!textGroup) {
          if (!digitEl.clipId) return;
          textGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          textGroup.setAttribute('clip-path', `url(#${digitEl.clipId})`);
          digitEl.group.appendChild(textGroup);
        }
        digitEl.textGroup = textGroup;
      }

      const prevDigit = previousValue !== null && previousValue !== undefined 
        ? Number(previousValue).toFixed(1).split('')[index] 
        : null;
      
      // Skip animation for decimal point
      if (digit === '.' || prevDigit === '.') {
        // Just update the decimal point without animation
        textGroup.innerHTML = '';
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', '0');
        text.setAttribute('y', digitHeight * 0.8);
        text.setAttribute('fill', fillColor);
        text.setAttribute('font-size', fontSize);
        text.setAttribute('font-family', 'monospace');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('style', 'text-anchor: start;');
        text.textContent = digit;
        textGroup.appendChild(text);
        return;
      }
      
      // If digit changed and is numeric, animate
      if (prevDigit !== null && prevDigit !== digit && !isNaN(Number(digit)) && !isNaN(Number(prevDigit))) {
        const currentNum = Number(digit);
        const prevNum = Number(prevDigit);
        const diff = currentNum - prevNum;
        
        // Create all possible digits for scrolling
        textGroup.innerHTML = '';
        const allDigits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
        const startIdx = prevNum;
        
        // Create text elements for scrolling (from bottom to top)
        // Position digits so they scroll from bottom to top
        for (let i = 0; i <= 10; i++) {
          const num = (startIdx + i) % 10;
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', '0');
          // Position digits starting from below (negative Y) going up
          // Base position is at digitHeight * 0.8 (visible area), digits below start at negative positions
          text.setAttribute('y', digitHeight * 0.8 + ((i - 5) * digitHeight));
          text.setAttribute('fill', fillColor);
          text.setAttribute('font-size', fontSize);
          text.setAttribute('font-family', 'monospace');
          text.setAttribute('font-weight', 'bold');
          text.setAttribute('style', 'text-anchor: start;');
          text.textContent = allDigits[num];
          textGroup.appendChild(text);
        }
        
        // Animate scroll from bottom to top
        // When diff is positive (number increases), we move up (negative Y transform)
        // When diff is negative (number decreases), we move down (positive Y transform)
        // Start position: digits are positioned so current digit is at y = digitHeight * 0.8
        // We need to move by -diff * digitHeight to show the new digit coming from bottom
        const endY = -diff * digitHeight;
        // Initial position: offset to show previous digit, then animate to show new digit from bottom
        const startOffset = 0; // Start at current position
        textGroup.setAttribute('transform', `translate(0, ${startOffset})`);
        
        // Use GSAP if available, otherwise use CSS animation
        // Increased duration from 0.6s to 1.2s to slow down the animation
        if (window.gsap && this._gsap) {
          this._gsap.to(textGroup, {
            attr: { transform: `translate(0, ${endY})` },
            duration: 1.2,
            ease: 'power2.out'
          });
        } else {
          // Fallback: immediate update with transition (slower: 1.2s instead of 0.6s)
          textGroup.style.transition = 'transform 1.2s ease-out';
          requestAnimationFrame(() => {
            textGroup.setAttribute('transform', `translate(0, ${endY})`);
          });
        }
      } else {
        // No animation needed, just update
        textGroup.innerHTML = '';
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', '0');
        text.setAttribute('y', digitHeight * 0.8);
        text.setAttribute('fill', fillColor);
        text.setAttribute('font-size', fontSize);
        text.setAttribute('font-family', 'monospace');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('style', 'text-anchor: start;');
        text.textContent = digit;
        textGroup.appendChild(text);
      }
    });

    // Add °C label after digits
    let labelEl = odometerGroup.querySelector('[data-role="temp-label"]');
    if (!labelEl) {
      labelEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      labelEl.setAttribute('data-role', 'temp-label');
      labelEl.setAttribute('x', digits.length * digitWidth + 2);
      labelEl.setAttribute('y', digitHeight * 0.8);
      labelEl.setAttribute('fill', fillColor);
      labelEl.setAttribute('font-size', fontSize);
      labelEl.setAttribute('font-family', 'monospace');
      labelEl.setAttribute('font-weight', 'bold');
      labelEl.setAttribute('style', 'text-anchor: start;');
      labelEl.textContent = '°C';
      odometerGroup.appendChild(labelEl);
    }
  }

  _updateAllToggleSwitches() {
    if (!this._domRefs) return;
    
    const updateToggles = (toggles) => {
      if (!toggles || !Array.isArray(toggles)) return;
      toggles.forEach((toggle) => {
        if (toggle && toggle.getAttribute && toggle.style.display !== 'none') {
          const entityId = toggle.getAttribute('data-entity-id');
          if (entityId) {
            this._updateToggleSwitch(toggle, entityId);
          }
        }
      });
    };

    updateToggles(this._domRefs.pvPopupToggles);
    updateToggles(this._domRefs.batteryPopupToggles);
    updateToggles(this._domRefs.housePopupToggles);
    updateToggles(this._domRefs.gridPopupToggles);
    updateToggles(this._domRefs.inverterPopupToggles);
  }

  _updatePopupLinesWithToggles(lines, sensorIds, lineElements, lineGroups, toggleElements, config, popupX, popupY, topPadding, lineHeight, prefix, popupWidth) {
    const toggleWidth = 40; // Width of toggle switch
    const adjustedPopupWidth = popupWidth || 200;
    
    // Phase A Optimization: Batch DOM updates for popup lines (reduces reflows)
    const domUpdates = [];
    
    lines.forEach((line, index) => {
      const element = lineElements[index];
      const group = lineGroups[index];
      const toggle = toggleElements[index];
      const sensorId = sensorIds[index];
      
      if (element && group) {
        const yPos = popupY + topPadding + (index * lineHeight) + (lineHeight / 2);
        // Adjust text position if toggle is present: move text left to make room for toggle
        const isControllable = sensorId && typeof sensorId === 'string' && sensorId.trim() && this._isEntityControllable(sensorId.trim());
        const textOffset = isControllable ? -35 : 0; // Move text left by 35px if toggle is present
        
        // Batch DOM updates
        domUpdates.push(() => {
          element.setAttribute('x', popupX + adjustedPopupWidth / 2 + textOffset);
          element.setAttribute('y', yPos);
          element.textContent = line;
          element.style.display = 'inline';
          
          // Apply font size
          const fontSizeKey = `${prefix}_${index + 1}_font_size`;
          const fontSize = config[fontSizeKey] || 16;
          element.setAttribute('font-size', fontSize);
          
          // Apply color
          const colorKey = `${prefix}_${index + 1}_color`;
          const color = config[colorKey] || '#80ffff';
          element.setAttribute('fill', color);
          
          // Show group
          group.style.display = 'inline';
          
          // Check if entity is controllable and show toggle (reuse isControllable from above)
          if (isControllable && toggle) {
            const trimmedSensorId = sensorId.trim();
            // Position toggle: popupX + popupWidth - toggleWidth - 15px margin from right edge
            // Adjust vertical alignment: raise toggle by 2px to better align with text
            const toggleWidth = 40; // Width of toggle switch
            const toggleX = popupX + adjustedPopupWidth - toggleWidth - 15;
            const toggleY = yPos - 6; // Raise toggle by 6px for better alignment
            toggle.setAttribute('transform', `translate(${toggleX}, ${toggleY})`);
            toggle.style.display = 'inline';
            
            // Set toggle to semi-transparent with cyan border
            const bgRect = toggle.querySelector('rect');
            if (bgRect) {
              bgRect.setAttribute('stroke', '#00FFFF');
              bgRect.setAttribute('stroke-width', '1.5');
              bgRect.setAttribute('opacity', '0.3');
              bgRect.style.stroke = '#00FFFF';
              bgRect.style.opacity = '0.3';
            }
            const sliderCircle = toggle.querySelector('circle');
            if (sliderCircle) {
              sliderCircle.setAttribute('opacity', '0.9');
              sliderCircle.style.opacity = '0.9';
            }
            
            // Update toggle state (on/off) using helper function
            this._updateToggleSwitch(toggle, trimmedSensorId);
            toggle.setAttribute('data-entity-id', trimmedSensorId);
          } else if (toggle) {
            toggle.style.display = 'none';
          }
        });
      }
    });
    
    // Hide unused lines (also batched)
    for (let i = lines.length; i < lineElements.length; i++) {
      const element = lineElements[i];
      const group = lineGroups[i];
      const toggle = toggleElements[i];
      domUpdates.push(() => {
        if (element) {
          element.style.display = 'none';
        }
        if (group) {
          group.style.display = 'none';
        }
        if (toggle) {
          toggle.style.display = 'none';
        }
      });
    }
    
    // Execute all DOM updates in a single batch (1 reflow instead of N)
    if (domUpdates.length > 0) {
      requestAnimationFrame(() => {
        for (let i = 0; i < domUpdates.length; i++) {
          domUpdates[i]();
        }
      });
    }
  }

  render() {
    // Phase A Optimization: Skip render if data hasn't changed
    // Collect sensor data first to check if anything changed
    if (!this._hass || !this.config) {
      return;
    }
    
    const config = this.config;
    const hasDeveloperValues = this.config && Object.keys(this.config).some(key => 
      key.startsWith('dev_text_') || 
      key.startsWith('dev_popup_') || 
      key.startsWith('dev_soc_bar_') || key.startsWith('soc_bar_') || key.startsWith('dev_grid_box_') || key.startsWith('dev_pv_box_')
    );

    if (!this._hass && hasDeveloperValues) {
      this._hass = { states: {} };
    }
    
    // Quick data hash check (skip expensive render if data unchanged)
    // Only skip if not forced and not in editor mode
    const isEditorActive = this._isEditorActive();
    if (!this._forceRender && !hasDeveloperValues && !isEditorActive) {
      try {
        const sensorCollector = new SensorDataCollector(this._hass, this.getStateSafe.bind(this));
        const sensorData = sensorCollector.collectAll(config);
        
        // Create lightweight hash of critical values
        // Only use values available in sensorData (car values calculated later)
        const dataHash = JSON.stringify({
          pv: Math.round(sensorData.total_pv_w || 0),
          bat: Math.round(sensorData.total_bat_w || 0),
          grid: Math.round(sensorData.gridNet || 0),
          load: Math.round(sensorData.houseTotalLoad || 0),
          soc: sensorData.avg_soc || 0,
          heat: Math.round(sensorData.heat_pump_w || 0)
        });
        
        if (this._lastDataHash === dataHash) {
          // Data unchanged, skip render but update timestamp
          this._lastRender = Date.now();
          return;
        }
        this._lastDataHash = dataHash;
      } catch (e) {
        // If hash check fails, proceed with render (fail-safe)
      }
    } else {
      // Force render or editor mode: clear hash to ensure render
      this._lastDataHash = null;
    }
    
    // Verify feature authorization using shared SHA-256 implementation
    // Define early to ensure it's available throughout the render method
    const verifyFeatureAuth = (inputValue) => {
      if (!inputValue || typeof inputValue !== 'string') return false;
      try {
        const trimmed = inputValue.trim();
        if (!trimmed) return false;
        const hashHex = LUMINA_SHA256(trimmed);
        const ok = LUMINA_AUTH_LIST && LUMINA_AUTH_LIST.includes(hashHex);
        if (LUMINA_AUTH_LIST === null) {
          LUMINA_REFRESH_AUTH(() => { this._forceRender = true; this._scheduleRender(); });
        }
        return ok;
      } catch (e) { return false; }
    };

    this._lastRender = Date.now();
    
    // Collect all sensor data using SensorDataCollector
    const sensorCollector = new SensorDataCollector(this._hass, this.getStateSafe.bind(this));
    const sensorData = sensorCollector.collectAll(config);
    
    // Extract sensor data for easier access
    const {
      pvStringIds, pvStringValues, pvArray2Ids, pvArray2Values, pv_primary_w, pv_secondary_w, total_pv_w,
      total_bat_w, avg_soc, batteryChargeDaily, batteryDischargeDaily,
      gridNet, gridImport, gridExport, gridImportDaily, gridExportDaily,
      gridDirection, gridMagnitude, gridActive, hasCombinedGrid,
      gridActivityThreshold, gridWarningThreshold, gridCriticalThreshold, use_kw,
      houseTotalLoad, loadValue, houseTempValue,
      heatPumpSensorId, hasHeatPumpSensor, heat_pump_w,
      total_daily_kwh, daily1, daily2
    } = sensorData;
    
    const showPvStrings = Boolean(config.show_pv_strings);
    
    // Additional threshold calculations
    // Optimized: using shared toNumber function instead of local definition
    const thresholdMultiplier = use_kw ? 1000 : 1;
    const gridWarningColor = typeof config.grid_warning_color === 'string' && config.grid_warning_color ? config.grid_warning_color : null;
    const gridCriticalColor = typeof config.grid_critical_color === 'string' && config.grid_critical_color ? config.grid_critical_color : null;
    const loadWarningThresholdRaw = toNumber(config.load_threshold_warning);
    const loadCriticalThresholdRaw = toNumber(config.load_threshold_critical);
    const loadWarningThreshold = loadWarningThresholdRaw !== null ? loadWarningThresholdRaw * thresholdMultiplier : null;
    const loadCriticalThreshold = loadCriticalThresholdRaw !== null ? loadCriticalThresholdRaw * thresholdMultiplier : null;
    const loadWarningColor = typeof config.load_warning_color === 'string' && config.load_warning_color ? config.load_warning_color : null;
    const loadCriticalColor = typeof config.load_critical_color === 'string' && config.load_critical_color ? config.load_critical_color : null;
    const gridDirectionSign = gridDirection >= 0 ? 1 : -1;
    const belowGridActivityThreshold = gridActivityThreshold > 0 && !gridActive;

    // EV Cars
    // Optimized: using shared helper functions instead of local definitions
    // Phase A Optimization: Early exit for car calculations if not needed
    const showCar1 = Boolean(config.show_car_soc);
    const showCar2Toggle = Boolean(config.show_car_soc2 !== undefined ? config.show_car_soc2 : config.show_car2);
    
    // Only resolve entity IDs if cars are enabled (saves string operations)
    const car1PowerSensorId = showCar1 ? resolveEntityId(config.sensor_car_power, config.car_power) : '';
    const car1SocSensorId = showCar1 ? resolveEntityId(config.sensor_car_soc, config.car_soc) : '';
    const car2PowerSensorId = showCar2Toggle ? resolveEntityId(config.sensor_car2_power, config.car2_power) : '';
    const car2SocSensorId = showCar2Toggle ? resolveEntityId(config.sensor_car2_soc, config.car2_soc) : '';
    const car2EntitiesConfigured = Boolean(car2PowerSensorId || car2SocSensorId);
    const showCar2 = showCar2Toggle && car2EntitiesConfigured;
    const showDebugGrid = DEBUG_GRID_ENABLED;
    
    // Only calculate car values if cars are enabled (saves getStateSafe calls)
    const car1Label = showCar1 ? resolveLabel(config.car1_label, 'CAR 1') : '';
    const car2Label = showCar2 ? resolveLabel(config.car2_label, 'CAR 2') : '';
    const car1PowerValue = showCar1 && car1PowerSensorId ? this.getStateSafe(car1PowerSensorId) : 0;
    const car1SocValue = showCar1 && car1SocSensorId ? this.getStateSafe(car1SocSensorId) : null;
    const car2PowerValue = showCar2 && car2PowerSensorId ? this.getStateSafe(car2PowerSensorId) : 0;
    const car2SocValue = showCar2 && car2SocSensorId ? this.getStateSafe(car2SocSensorId) : null;
    const car1Bidirectional = Boolean(config.car1_bidirectional);
    const car2Bidirectional = Boolean(config.car2_bidirectional);
    const car1InvertFlow = Boolean(config.car1_invert_flow);
    const car2InvertFlow = Boolean(config.car2_invert_flow);
    const array1InvertFlow = Boolean(config.array1_invert_flow);
    const array2InvertFlow = Boolean(config.array2_invert_flow);
    const carLayoutKey = showCar2 ? 'dual' : 'single';
    const carLayout = CAR_LAYOUTS[carLayoutKey];
    // Phase A Optimization: Use cache for car text transforms
    const car1Transforms = buildCarTextTransforms(carLayout.car1, this._textTransformCache);
    const car2Transforms = buildCarTextTransforms(carLayout.car2, this._textTransformCache);

    // PV Popup - optimized: combine operations and cache entity names
    const popupPvSensorIds = [
      config.sensor_popup_pv_1,
      config.sensor_popup_pv_2,
      config.sensor_popup_pv_3,
      config.sensor_popup_pv_4,
      config.sensor_popup_pv_5,
      config.sensor_popup_pv_6
    ];
    const popupPvNamesConfig = [
      config.sensor_popup_pv_1_name,
      config.sensor_popup_pv_2_name,
      config.sensor_popup_pv_3_name,
      config.sensor_popup_pv_4_name,
      config.sensor_popup_pv_5_name,
      config.sensor_popup_pv_6_name
    ];
    // Optimized: combine operations in single loop, cache type checks
    const popupPvValues = [];
    const popupPvNames = [];
    for (let i = 0; i < 6; i++) {
      const sensorId = popupPvSensorIds[i];
      popupPvValues[i] = this.formatPopupValue(null, sensorId);
      const nameConfig = popupPvNamesConfig[i];
      // Optimized: cache type check and trim result
      const trimmedName = (nameConfig && typeof nameConfig === 'string') ? nameConfig.trim() : '';
      popupPvNames[i] = trimmedName || this.getEntityName(sensorId);
    }

    // House Popup - optimized: combine operations and cache entity names
    const popupHouseSensorIds = [
      config.sensor_popup_house_1,
      config.sensor_popup_house_2,
      config.sensor_popup_house_3,
      config.sensor_popup_house_4,
      config.sensor_popup_house_5,
      config.sensor_popup_house_6
    ];
    const popupHouseNamesConfig = [
      config.sensor_popup_house_1_name,
      config.sensor_popup_house_2_name,
      config.sensor_popup_house_3_name,
      config.sensor_popup_house_4_name,
      config.sensor_popup_house_5_name,
      config.sensor_popup_house_6_name
    ];
    // Optimized: combine operations in single loop, cache type checks
    const popupHouseValues = [];
    const popupHouseNames = [];
    for (let i = 0; i < 6; i++) {
      const sensorId = popupHouseSensorIds[i];
      popupHouseValues[i] = this.formatPopupValue(null, sensorId);
      const nameConfig = popupHouseNamesConfig[i];
      // Optimized: cache type check and trim result
      const trimmedName = (nameConfig && typeof nameConfig === 'string') ? nameConfig.trim() : '';
      popupHouseNames[i] = trimmedName || this.getEntityName(sensorId);
    }

    // Display settings: single background always (no heat-pump–specific image)
    const bg_img = config.background_image || '/local/community/lumina-energy-card/lumina_background1.png';
    // Optimized: cache trim result to avoid repeated calls
    const cardTitleRaw = config.card_title;
    const title_text = (typeof cardTitleRaw === 'string' && cardTitleRaw.trim()) ? cardTitleRaw.trim() : null;
    
    // Optimized: using shared resolveColor function instead of local definition
    
    // Check if premium features are enabled
    const authInput = config.pro_password;
    if (typeof verifyFeatureAuth !== 'function') {
      throw new Error('verifyFeatureAuth is not defined or not a function at first check');
    }
    const isProEnabled = verifyFeatureAuth(authInput);

    // Optimized: using shared clampValue function instead of local definition
    const header_font_size = clampValue(config.header_font_size, 12, 32, 16);
    const daily_label_font_size = clampValue(config.daily_label_font_size, 8, 24, 12);
    const daily_value_font_size = clampValue(config.daily_value_font_size, 12, 32, 20);
    // Unified font size for all text elements - default 12px
    const unified_font_size = clampValue(config.text_font_size || config.pv_font_size || config.battery_font_size || config.grid_font_size || config.car_font_size || config.heat_pump_font_size || config.house_font_size, 8, 32, 12);
    const pv_font_size = unified_font_size;
    const battery_soc_font_size = unified_font_size;
    const battery_power_font_size = unified_font_size;
    const load_font_size = unified_font_size;
    const heat_pump_font_size = unified_font_size;
    const grid_font_size = unified_font_size;
    const car_power_font_size = unified_font_size;
    const car_soc_font_size = unified_font_size;
    const car2_power_font_size = unified_font_size;
    const car2_soc_font_size = unified_font_size;
    const car_name_font_size = unified_font_size;
    const car2_name_font_size = unified_font_size;
    const battery_font_size = unified_font_size;
    const house_font_size = unified_font_size;
    const car_font_size = unified_font_size;
    const animation_speed_factor = clampValue(config.animation_speed_factor, -3, 3, 1);
    this._animationSpeedFactor = animation_speed_factor;
    const animation_style = this._normalizeAnimationStyle(config.animation_style);
    this._animationStyle = animation_style;

    // Debugging: logs fluid_flow mask + animator lifecycle into the browser console.
    // Enable with YAML: debug_fluid_flow: true
    this._debugFluidFlow = Boolean(config.debug_fluid_flow);

    // Flow stroke width overrides (no SVG editing required).
    // - flow_stroke_width: applies to non-fluid flow styles (dashes/dots/etc)
    const flow_stroke_width = (() => {
      const raw = toNumber(config.flow_stroke_width);
      if (raw === null) return 1; // Default value
      const v = Number(raw);
      if (!Number.isFinite(v)) return 1; // Default value
      return Math.min(Math.max(v, 0.5), 30);
    })();
    this._flowStrokeWidthPx = flow_stroke_width;

    // Flow path offsets (for manual positioning)
    this._flowOffsets = {
      pv1: { x: Number(config.pv1_flow_offset_x) || 0, y: Number(config.pv1_flow_offset_y) || 0 },
      pv2: { x: Number(config.pv2_flow_offset_x) || 0, y: Number(config.pv2_flow_offset_y) || 0 },
      bat: { x: Number(config.bat_flow_offset_x) || 0, y: Number(config.bat_flow_offset_y) || 0 },
      load: { x: Number(config.load_flow_offset_x) || 0, y: Number(config.load_flow_offset_y) || 0 },
      grid: { x: Number(config.grid_flow_offset_x) || 0, y: Number(config.grid_flow_offset_y) || 0 },
      grid_house: { x: Number(config.grid_house_flow_offset_x) || 0, y: Number(config.grid_house_flow_offset_y) || 0 },
      car1: { x: Number(config.car1_flow_offset_x) || 0, y: Number(config.car1_flow_offset_y) || 0 },
      car2: { x: Number(config.car2_flow_offset_x) || 0, y: Number(config.car2_flow_offset_y) || 0 },
      heatPump: { x: Number(config.heat_pump_flow_offset_x) || 0, y: Number(config.heat_pump_flow_offset_y) || 0 }
    };

    // Add custom flow offsets (only if Pro is enabled)
    if (isProEnabled) {
      for (let i = 1; i <= 5; i++) {
        const enabled = Boolean(config[`custom_flow_${i}_enabled`]);
        if (enabled) {
          this._flowOffsets[`custom_flow_${i}`] = {
            x: Number(config[`custom_flow_${i}_offset_x`]) || 0,
            y: Number(config[`custom_flow_${i}_offset_y`]) || 0
          };
        }
      }
    }

    // Language: config.language, else hass.locale (e.g. it-IT -> it), else en
    // Optimized: cache split and toLowerCase
    let lang = config.language;
    if (!lang && this._hass && this._hass.locale) {
      const locale = this._hass.locale;
      const dashIdx = locale.indexOf('-');
      lang = dashIdx > 0 ? locale.substring(0, dashIdx) : locale;
    }
    lang = (lang || 'en').toLowerCase();
    // Prefer locale strings (external or built-in) when available
    let label_daily = null;
    let label_pv_tot = null;
    let label_importing = null;
    let label_exporting = null;
    let label_battery_power = null;
    try {
      const localeStrings = (typeof this._getLocaleStrings === 'function') ? this._getLocaleStrings() : null;
      if (localeStrings && localeStrings.view) {
        label_daily = localeStrings.view.daily || null;
        label_pv_tot = localeStrings.view.pv_tot || null;
        label_importing = localeStrings.view.importing || null;
        label_exporting = localeStrings.view.exporting || null;
        label_battery_power = localeStrings.view.battery_power || null;
      }
    } catch (e) {
      // ignore
    }
    // Fallback to small built-in dictionaries if locales don't provide values
    if (!label_daily) {
      const dict_daily = { it: 'PRODUZIONE OGGI', en: 'DAILY YIELD', de: 'TAGESERTRAG', fr: 'PRODUCTION DU JOUR', nl: 'DAGOPBRENGST' };
      label_daily = dict_daily[lang] || dict_daily['en'];
    }
    if (!label_pv_tot) {
      const dict_pv_tot = { it: 'PV Totale', en: 'PV Total', de: 'PV Gesamt', fr: 'PV Total', nl: 'PV Totaal' };
      label_pv_tot = dict_pv_tot[lang] || dict_pv_tot['en'];
    }
    if (!label_importing) {
      const dict_importing = { it: 'IMPORTAZIONE', en: 'IMPORTING', de: 'IMPORTIEREN', fr: 'IMPORTATION', nl: 'IMPORTEREN' };
      label_importing = dict_importing[lang] || dict_importing['en'];
    }
    if (!label_exporting) {
      const dict_exporting = { it: 'ESPORTAZIONE', en: 'EXPORTING', de: 'EXPORTIEREN', fr: 'EXPORTATION', nl: 'EXPORTEREN' };
      label_exporting = dict_exporting[lang] || dict_exporting['en'];
    }
    let label_import_day = null;
    let label_export_day = null;
    let label_daily_production = null;
    const dict_import_day = { it: 'Importazione giornaliera', en: 'Daily import', de: 'Täglicher Import', fr: 'Import journalier', nl: 'Dagelijkse import' };
    const dict_export_day = { it: 'Esportazione giornaliera', en: 'Daily export', de: 'Täglicher Export', fr: 'Export journalier', nl: 'Dagelijkse export' };
    const dict_daily_production = { it: 'Produzione giornaliera', en: 'Daily production', de: 'Tagesproduktion', fr: 'Production journalière', nl: 'Dagelijkse productie' };
    label_import_day = dict_import_day[lang] || dict_import_day['en'];
    label_export_day = dict_export_day[lang] || dict_export_day['en'];
    label_daily_production = dict_daily_production[lang] || dict_daily_production['en'];
    if (!label_battery_power) {
      const dict_battery_power = { it: 'Potenza batteria', en: 'Battery Power', de: 'Batterieleistung', fr: 'Puissance batterie', nl: 'Batterij vermogen' };
      label_battery_power = dict_battery_power[lang] || dict_battery_power['en'];
    }

    const C_CYAN = '#00FFFF';
    const C_BLUE = '#0088FF';
    const C_WHITE = '#00f9f9';
    const C_RED = '#FF3333';
    const pvPrimaryColor = resolveColor(config.pv_primary_color, C_CYAN);
    const pvTotColor = resolveColor(config.pv_tot_color, pvPrimaryColor);
    const pvSecondaryColor = resolveColor(config.pv_secondary_color, C_BLUE);
    const pvStringColorKeys = [
      'pv_string1_color',
      'pv_string2_color',
      'pv_string3_color',
      'pv_string4_color',
      'pv_string5_color',
      'pv_string6_color'
    ];
    const getPvStringColor = (index) => {
      const key = pvStringColorKeys[index];
      if (!key) {
        return pvPrimaryColor;
      }
      return resolveColor(config[key], pvPrimaryColor);
    };
    const loadFlowColor = resolveColor(config.load_flow_color, C_CYAN);
    const loadTextBaseColor = resolveColor(config.load_text_color, '#00f9f9');
    const batterySocTextColor = resolveColor(config.battery_soc_color, '#00f9f9');
    const batteryChargeColor = resolveColor(config.battery_charge_color, C_CYAN);
    const batteryDischargeColor = resolveColor(config.battery_discharge_color, '#00f9f9');
    const liquid_fill = DEFAULT_BATTERY_FILL_HIGH_COLOR;
    const gridImportColor = resolveColor(config.grid_import_color, C_RED);
    const gridExportColor = resolveColor(config.grid_export_color, C_CYAN);
    const carFlowColor = resolveColor(config.car_flow_color, C_CYAN);
    const heatPumpFlowColor = resolveColor(config.heat_pump_flow_color, '#FFA500');
    const heatPumpTextColor = resolveColor(config.heat_pump_text_color, '#00f9f9');
    const pvTextColor = resolveColor(config.pv_text_color, '#00f9f9');
    const pvSecondaryTextColor = resolveColor(config.pv_secondary_text_color, pvSecondaryColor || '#00f9f9');
    const batteryTextColor = resolveColor(config.battery_text_color, PEARL_WHITE);
    const gridTextColor = resolveColor(config.grid_text_color, '#00f9f9');
    const houseTextColor = resolveColor(config.house_text_color, PEARL_WHITE);
    const carTextColor = resolveColor(config.car_text_color, PEARL_WHITE);
    const loadMagnitude = Math.abs(houseTotalLoad);
    const effectiveLoadFlowColor = (() => {
      if (loadCriticalColor && loadCriticalThreshold !== null && loadMagnitude >= loadCriticalThreshold) {
        return loadCriticalColor;
      }
      if (loadWarningColor && loadWarningThreshold !== null && loadMagnitude >= loadWarningThreshold) {
        return loadWarningColor;
      }
      return loadFlowColor;
    })();
    const effectiveLoadTextColor = (() => {
      if (loadCriticalColor && loadCriticalThreshold !== null && loadMagnitude >= loadCriticalThreshold) {
        return loadCriticalColor;
      }
      if (loadWarningColor && loadWarningThreshold !== null && loadMagnitude >= loadWarningThreshold) {
        return loadWarningColor;
      }
      return loadTextBaseColor;
    })();
    const invertBattery = Boolean(config.invert_battery);
    const isBatPositive = total_bat_w >= 0;
    const bat_col = isBatPositive
      ? (invertBattery ? batteryDischargeColor : batteryChargeColor)
      : (invertBattery ? batteryChargeColor : batteryDischargeColor);
    let batteryDirectionSign = isBatPositive ? 1 : -1;
    if (invertBattery) batteryDirectionSign *= -1;
    const base_grid_color = belowGridActivityThreshold
      ? gridExportColor
      : (gridDirectionSign >= 0 ? gridImportColor : gridExportColor);
    const effectiveGridColor = (() => {
      const magnitude = gridMagnitude;
      if (gridCriticalColor && gridCriticalThreshold !== null && magnitude >= gridCriticalThreshold) {
        return gridCriticalColor;
      }
      if (gridWarningColor && gridWarningThreshold !== null && magnitude >= gridWarningThreshold) {
        return gridWarningColor;
      }
      return base_grid_color;
    })();
    const gridAnimationDirection = -gridDirectionSign;
    const installationType = config.installation_type || '1';
    const hidePvAndBattery = installationType === '3';
    const show_double_flow = (pv_primary_w > 10 && pv_secondary_w > 10);
    const pvLinesRaw = [];
    // If installation type is 3 (no PV), don't show PV text
    if (!hidePvAndBattery) {
      // If Array 2 is producing, show totals only: Array 1 total, Array 2 total (PV totale è già nel box PV)
      if (pv_secondary_w > 10) {
        const array1TextColor = resolveColor(config.pv_text_color, pvPrimaryColor);
        const array2TextColor = resolveColor(config.pv_secondary_text_color, pvSecondaryColor);
        pvLinesRaw.push({ key: 'pv-primary-total', text: `Array 1: ${this.formatPower(pv_primary_w, use_kw)}`, fill: array1TextColor });
        pvLinesRaw.push({ key: 'pv-secondary-total', text: `Array 2: ${this.formatPower(pv_secondary_w, use_kw)}`, fill: array2TextColor });
      } else if (showPvStrings) {
        pvStringValues.forEach((value, index) => {
          const lineColor = getPvStringColor(index);
          pvLinesRaw.push({ key: `pv-string-${index + 1}`, text: `S${index + 1}: ${this.formatPower(value, use_kw)}`, fill: lineColor });
        });
      } else if (pvStringValues.length === 2) {
        pvLinesRaw.push({ key: 'pv-string-1', text: `S1: ${this.formatPower(pvStringValues[0], use_kw)}`, fill: getPvStringColor(0) });
        pvLinesRaw.push({ key: 'pv-string-2', text: `S2: ${this.formatPower(pvStringValues[1], use_kw)}`, fill: getPvStringColor(1) });
      } else if (pvStringValues.length > 2) {
        // Show all strings when more than 2 are configured
        pvStringValues.forEach((value, index) => {
          const lineColor = getPvStringColor(index);
          pvLinesRaw.push({ key: `pv-string-${index + 1}`, text: `S${index + 1}: ${this.formatPower(value, use_kw)}`, fill: lineColor });
        });
      } else {
        // If only Array 1 is active, show "Array 1:" prefix
        if (pv_primary_w > 10 && pv_secondary_w <= 10) {
          const array1TextColor = resolveColor(config.pv_text_color, pvPrimaryColor);
          pvLinesRaw.push({ key: 'pv-primary-total', text: `Array 1: ${this.formatPower(pv_primary_w, use_kw)}`, fill: array1TextColor });
        } else {
          pvLinesRaw.push({ key: 'pv-total', text: this.formatPower(total_pv_w, use_kw), fill: pvTotColor });
        }
      }
    }

    const lineCount = Math.min(pvLinesRaw.length, MAX_PV_LINES);
    const TEXT_POSITIONS = getTextPositions(this.config);
    const baseY = TEXT_POSITIONS.solar.y - ((lineCount > 0 ? lineCount - 1 : 0) * PV_LINE_SPACING) / 2;
    const pvLines = Array.from({ length: MAX_PV_LINES }, (_, index) => {
      if (index < lineCount) {
        const line = pvLinesRaw[index];
        return { ...line, y: baseY + index * PV_LINE_SPACING, visible: true };
      }
      return {
        key: `pv-placeholder-${index}`,
        text: '',
        fill: C_CYAN,
        y: baseY + index * PV_LINE_SPACING,
        visible: false
      };
    });

    // Build load display lines when Array 2 is active (include per-line colours)
    const inv1Fill = resolveColor(config.inv1_color, pvPrimaryColor);
    const inv2Fill = resolveColor(config.inv2_color, pvSecondaryColor);
    const language = config.language || 'en';
    const houseTotLabel = this._getHouseTotLabel(language);
    // Always use single line with total (houseTotalLoad already includes both inverters)
    const loadLines = null;

    const loadY = TEXT_POSITIONS.home.y;

    const hasPrimarySolar = Boolean((typeof config.sensor_pv_total === 'string' && config.sensor_pv_total.trim()) || pvStringIds.length > 0);
    const hasSecondarySolar = Boolean((typeof config.sensor_pv_total_secondary === 'string' && config.sensor_pv_total_secondary.trim()) || pvArray2Ids.length > 0);
    // Use house grid path if there's no primary solar (inverter 1)
    // This ensures the grid_house flow is visible even when only inverter 2 is active
    const useHouseGridPath = !hasPrimarySolar;
    const pvUiPreviouslyEnabled = this._pvUiEnabled !== undefined ? this._pvUiEnabled : true;
    // Enable PV UI if there's primary solar (inverter 1) OR secondary solar (inverter 2)
    const pvUiEnabled = hasPrimarySolar || hasSecondarySolar;
    if (pvUiPreviouslyEnabled && !pvUiEnabled) {
      this._hidePvPopup();
    }
    this._pvUiEnabled = pvUiEnabled;
    const gridActiveForGrid = !useHouseGridPath && gridActive;
    // grid_house flow should be active if:
    // 1. There's no primary solar (useHouseGridPath is true) AND grid is active, OR
    // 2. There's only secondary solar (inverter 2) AND grid is active
    const gridActiveForHouse = (useHouseGridPath && gridActive) || (hasSecondarySolar && !hasPrimarySolar && gridActive);

    const flows = {
      pv1: { stroke: pvPrimaryColor, glowColor: pvPrimaryColor, active: pv_primary_w > 10 },
      pv2: { stroke: pvSecondaryColor, glowColor: pvSecondaryColor, active: pv_secondary_w > 10 },
      bat: { stroke: bat_col, glowColor: bat_col, active: Math.abs(total_bat_w) > 10, direction: batteryDirectionSign },
      load: { stroke: effectiveLoadFlowColor, glowColor: effectiveLoadFlowColor, active: loadMagnitude > 10, direction: 1 },
      grid: { stroke: effectiveGridColor, glowColor: effectiveGridColor, active: gridActiveForGrid, direction: gridAnimationDirection },
      grid_house: { stroke: effectiveGridColor, glowColor: effectiveGridColor, active: gridActiveForHouse, direction: gridAnimationDirection },
      car1: { stroke: carFlowColor, glowColor: carFlowColor, active: showCar1 && Math.abs(car1PowerValue) > 10, direction: (() => {
        let dir = car1Bidirectional ? (car1PowerValue >= 0 ? 1 : -1) : 1;
        return car1InvertFlow ? -dir : dir;
      })() },
      car2: { stroke: carFlowColor, glowColor: carFlowColor, active: showCar2 && Math.abs(car2PowerValue) > 10, direction: (() => {
        let dir = car2Bidirectional ? (car2PowerValue >= 0 ? 1 : -1) : 1;
        return car2InvertFlow ? -dir : dir;
      })() },
      heatPump: { stroke: heatPumpFlowColor, glowColor: heatPumpFlowColor, active: hasHeatPumpSensor && heat_pump_w > 10, direction: 1 }
    };
    
    flows.pv1.direction = array1InvertFlow ? -1 : 1;
    flows.pv2.direction = array2InvertFlow ? -1 : 1;
    // Car directions are already set based on bidirectional mode above
    flows.heatPump.direction = 1;

    // Add custom flows (only if Pro is enabled)
    if (isProEnabled) {
      for (let i = 1; i <= 5; i++) {
        const flowKey = `custom_flow_${i}`;
        const enabled = Boolean(config[`custom_flow_${i}_enabled`]);
        
        // Only process if enabled
        if (!enabled) {
          continue;
        }

        const sensorId = config[`custom_flow_${i}_sensor`];
        const pathPreset = config[`custom_flow_${i}_path_preset`] || 'custom';
        let path;

        // Determine path based on preset or custom coordinates
        if (pathPreset !== 'custom' && PRESET_PATHS[pathPreset]) {
          path = PRESET_PATHS[pathPreset].path;
        } else {
          // Use manual path or generate from coordinates
          const manualPath = config[`custom_flow_${i}_path`];
          if (manualPath && typeof manualPath === 'string' && manualPath.trim()) {
            path = manualPath.trim();
          } else {
            // Generate path from coordinates
            const startX = Number(config[`custom_flow_${i}_start_x`]) || 100;
            const startY = Number(config[`custom_flow_${i}_start_y`]) || 200;
            const endX = Number(config[`custom_flow_${i}_end_x`]) || 600;
            const endY = Number(config[`custom_flow_${i}_end_y`]) || 250;
            path = `M ${startX} ${startY} L ${endX} ${endY}`;
          }
        }

        // Skip if no sensor or path
        if (!sensorId || !path) {
          continue;
        }

        const color = resolveColor(config[`custom_flow_${i}_color`], '#00FFFF');
        const threshold = Number(config[`custom_flow_${i}_threshold`]) || 10;
        const directionMode = config[`custom_flow_${i}_direction`] || 'auto';

        // Get sensor value
        const powerValue = sensorId ? this.getStateSafe(sensorId.trim()) : 0;
        const powerMagnitude = Math.abs(powerValue);

        // Determine if flow is active
        const isActive = powerMagnitude > threshold;

        // Determine direction
        let direction = 1; // default forward
        if (directionMode === 'reverse') {
          direction = -1;
        } else if (directionMode === 'auto') {
          direction = powerValue >= 0 ? 1 : -1;
        }

        // Only add to flows if enabled and has valid sensor/path
        flows[flowKey] = {
          stroke: color,
          glowColor: color,
          active: isActive,
          direction: direction
        };
      }
    }

    const flowDurations = Object.fromEntries(
      Object.entries(flows).map(([key, state]) => [key, state.active ? 1 : 0])
    );

    // Use custom paths if provided, otherwise use defaults
    const flowPaths = {
      pv1: (config.pv1_flow_path && typeof config.pv1_flow_path === 'string' && config.pv1_flow_path.trim()) ? this._sanitizePath(config.pv1_flow_path) || FLOW_PATHS.pv1 : FLOW_PATHS.pv1,
      pv2: (config.pv2_flow_path && typeof config.pv2_flow_path === 'string' && config.pv2_flow_path.trim()) ? this._sanitizePath(config.pv2_flow_path) || FLOW_PATHS.pv2 : FLOW_PATHS.pv2,
      bat: (config.bat_flow_path && typeof config.bat_flow_path === 'string' && config.bat_flow_path.trim()) ? this._sanitizePath(config.bat_flow_path) || FLOW_PATHS.bat : FLOW_PATHS.bat,
      load: (config.load_flow_path && typeof config.load_flow_path === 'string' && config.load_flow_path.trim()) ? this._sanitizePath(config.load_flow_path) || FLOW_PATHS.load : FLOW_PATHS.load,
      grid: (config.grid_flow_path && typeof config.grid_flow_path === 'string' && config.grid_flow_path.trim()) ? this._sanitizePath(config.grid_flow_path) || FLOW_PATHS.grid : FLOW_PATHS.grid,
      grid_house: (config.grid_house_flow_path && typeof config.grid_house_flow_path === 'string' && config.grid_house_flow_path.trim()) ? this._sanitizePath(config.grid_house_flow_path) || FLOW_PATHS.grid_house : FLOW_PATHS.grid_house,
      car1: (config.car1_flow_path && typeof config.car1_flow_path === 'string' && config.car1_flow_path.trim()) ? this._sanitizePath(config.car1_flow_path) || FLOW_PATHS.car1 : FLOW_PATHS.car1,
      car2: (config.car2_flow_path && typeof config.car2_flow_path === 'string' && config.car2_flow_path.trim()) ? this._sanitizePath(config.car2_flow_path) || FLOW_PATHS.car2 : FLOW_PATHS.car2,
      heatPump: (config.heat_pump_flow_path && typeof config.heat_pump_flow_path === 'string' && config.heat_pump_flow_path.trim()) ? this._sanitizePath(config.heat_pump_flow_path) || FLOW_PATHS.heatPump : FLOW_PATHS.heatPump,
      custom_flow_1: 'M 0 0',
      custom_flow_2: 'M 0 0',
      custom_flow_3: 'M 0 0',
      custom_flow_4: 'M 0 0',
      custom_flow_5: 'M 0 0'
    };

    // Add custom flow paths (only if Pro is enabled)
    if (isProEnabled) {
      for (let i = 1; i <= 5; i++) {
        const flowKey = `custom_flow_${i}`;
        const pathPreset = config[`custom_flow_${i}_path_preset`] || 'custom';
        let path;

        if (pathPreset !== 'custom' && PRESET_PATHS[pathPreset]) {
          path = PRESET_PATHS[pathPreset].path;
        } else {
          const manualPath = config[`custom_flow_${i}_path`];
          if (manualPath && typeof manualPath === 'string' && manualPath.trim()) {
            path = manualPath.trim();
          } else {
            const startX = Number(config[`custom_flow_${i}_start_x`]) || 100;
            const startY = Number(config[`custom_flow_${i}_start_y`]) || 200;
            const endX = Number(config[`custom_flow_${i}_end_x`]) || 600;
            const endY = Number(config[`custom_flow_${i}_end_y`]) || 250;
            path = `M ${startX} ${startY} L ${endX} ${endY}`;
          }
        }

        if (path) {
          const sanitized = this._sanitizePath(path);
          flowPaths[flowKey] = sanitized || path;
        }
      }
    }

    // Apply path reversal to ALL flows with negative direction
    // This ensures the animation always starts at the source of the energy (the M point)
    Object.keys(flows).forEach(key => {
      if (flows[key] && flows[key].direction < 0 && flowPaths[key]) {
        flowPaths[key] = this._reversePath(flowPaths[key]);
        // After reversing the path, we set the logical direction to 1 (forward)
        // because the path itself now points from source to target.
        flows[key].direction = 1;
      }
    });

    const car1Color = resolveColor(config.car1_color, C_WHITE);
    const car2Color = resolveColor(config.car2_color, C_WHITE);
    const car1NameColor = resolveColor(config.car1_name_color, car1Color);
    const car2NameColor = resolveColor(config.car2_name_color, car2Color);
    const car1SocColor = resolveColor(config.car_pct_color, '#00FFFF');
    const car2SocColor = resolveColor(config.car2_pct_color, car1SocColor);
    const buildCarView = (visible, label, powerValue, socValue, transforms, positions, nameFontSize, powerFontSize, socFontSize, textColor, nameColor, socColor) => {
      const textX = (typeof positions.x === 'number') ? positions.x : CAR_TEXT_BASE.x;
      return {
        visible,
        label: {
          text: visible ? label : '',
          fontSize: nameFontSize,
          fill: nameColor,
          x: textX,
          y: positions.labelY,
          transform: transforms.label
        },
        power: {
          text: visible ? this.formatPower(powerValue, use_kw) : '',
          fontSize: powerFontSize,
          fill: textColor,
          x: textX,
          y: positions.powerY,
          transform: transforms.power
        },
        soc: {
          visible: visible && socValue !== null,
          text: (visible && socValue !== null) ? `${Math.round(socValue)}%` : '',
          fontSize: socFontSize,
          fill: socColor,
          x: textX,
          y: positions.socY,
          transform: transforms.soc
        }
      };
    };

    const customTexts = [];
    if (isProEnabled) {
      for (let i = 1; i <= 5; i++) {
        const enabled = Boolean(config[`custom_text_${i}_enabled`]);
        if (!enabled) continue;

        const staticText = config[`custom_text_${i}_text`] || '';
        const sensorId = config[`custom_text_${i}_sensor`];
        let displayText = staticText;

        if (sensorId && typeof sensorId === 'string' && sensorId.trim()) {
          const sensorState = this._hass ? this._hass.states[sensorId.trim()] : null;
          if (sensorState) {
            const unit = sensorState.attributes && sensorState.attributes.unit_of_measurement ? sensorState.attributes.unit_of_measurement : '';
            displayText = staticText ? `${staticText}: ${sensorState.state}${unit}` : `${sensorState.state}${unit}`;
          }
        }

        customTexts.push({
          id: i,
          text: displayText,
          x: Number(config[`custom_text_${i}_x`]) || 400,
          y: Number(config[`custom_text_${i}_y`]) || 100 + (i - 1) * 50,
          color: resolveColor(config[`custom_text_${i}_color`], '#00f9f9'),
          size: Number(config[`custom_text_${i}_size`]) || 16
        });
      }
      
      // Solar Forecast Sensor
      const solarForecastEnabled = Boolean(config.solar_forecast_enabled);
      if (!solarForecastEnabled) {
        this._solarForecastData = null;
      } else if (solarForecastEnabled) {
        const sensorId = config.sensor_solar_forecast;
        if (sensorId && typeof sensorId === 'string' && sensorId.trim()) {
          const sensorState = this._hass ? this._hass.states[sensorId.trim()] : null;
          if (sensorState) {
            const forecastValue = parseFloat(sensorState.state) || 0;
            const maxPower = Number(config.solar_forecast_max_power) || 10000;
            const percentage = maxPower > 0 ? (forecastValue / maxPower) * 100 : 0;
            
            // Determine sun status based on percentage
            let sunStatus = '';
            const lang = config.language || 'en';
            const sunStatusDict = {
              it: { high: 'Tanto sole', medium: 'Sole moderato', low: 'Poco sole' },
              en: { high: 'Lots of sun', medium: 'Moderate sun', low: 'Little sun' },
              de: { high: 'Viel Sonne', medium: 'Mäßige Sonne', low: 'Wenig Sonne' },
              fr: { high: 'Beaucoup de soleil', medium: 'Soleil modéré', low: 'Peu de soleil' },
              nl: { high: 'Veel zon', medium: 'Matige zon', low: 'Weinig zon' }
            };
            
            const dict = sunStatusDict[lang] || sunStatusDict['en'];
            if (percentage >= 70) {
              sunStatus = dict.high;
            } else if (percentage >= 30) {
              sunStatus = dict.medium;
            } else {
              sunStatus = dict.low;
            }
            
            const unit = sensorState.attributes && sensorState.attributes.unit_of_measurement ? sensorState.attributes.unit_of_measurement : 'W';
            const formattedValue = this.formatPower(forecastValue, use_kw);
            const displayText = `${formattedValue} - ${sunStatus}`;
            
            // Store solar forecast data for SVG rendering
            this._solarForecastData = {
              enabled: true,
              percentage: percentage,
              value: forecastValue,
              status: sunStatus,
              x: Number(config.solar_forecast_x) || 400,
              y: Number(config.solar_forecast_y) || 350,
              color: resolveColor(config.solar_forecast_color, '#00FFFF'),
              size: Number(config.solar_forecast_size) || 16,
              text: displayText
            };
            
            customTexts.push({
              id: 'solar_forecast',
              text: displayText,
              x: Number(config.solar_forecast_x) || 400,
              y: Number(config.solar_forecast_y) || 350,
              color: resolveColor(config.solar_forecast_color, '#00FFFF'),
              size: Number(config.solar_forecast_size) || 16
            });
          } else {
            this._solarForecastData = null;
          }
        }
      }
    }

    const car1View = buildCarView(showCar1, car1Label, car1PowerValue, car1SocValue, car1Transforms, carLayout.car1, car_font_size, car_font_size, car_font_size, carTextColor, carTextColor, carTextColor);
    const car2View = buildCarView(showCar2, car2Label, car2PowerValue, car2SocValue, car2Transforms, carLayout.car2, car_font_size, car_font_size, car_font_size, carTextColor, carTextColor, carTextColor);
    const gridValueText = this.formatPower(Math.abs(gridNet), use_kw);

    // Overlay images (up to 5)
    const overlayImages = [];
    for (let i = 1; i <= 5; i++) {
      const suffix = i === 1 ? '' : `_${i}`;
      const enabled = isProEnabled ? Boolean(config[`overlay_image${suffix}_enabled`]) : false;
      const image = (isProEnabled && enabled && (typeof config[`overlay_image${suffix}`] === 'string' && config[`overlay_image${suffix}`].trim())) ? config[`overlay_image${suffix}`].trim() : null;
      const x = Number(config[`overlay_image${suffix}_x`]) || 0;
      const y = Number(config[`overlay_image${suffix}_y`]) || 0;
      const width = Number(config[`overlay_image${suffix}_width`]) || 800;
      const height = Number(config[`overlay_image${suffix}_height`]) || 450;
      const opacity = Math.max(0, Math.min(1, Number(config[`overlay_image${suffix}_opacity`]) || 1.0));

      overlayImages.push({
        enabled: enabled,
        image: image,
        x: x,
        y: y,
        width: width,
        height: height,
        opacity: opacity
      });
    }

    // Legacy variables for backward compatibility
    const overlayImageEnabled = overlayImages[0].enabled;
    const overlayImage = overlayImages[0].image;
    const overlayX = overlayImages[0].x;
    const overlayY = overlayImages[0].y;
    const overlayWidth = overlayImages[0].width;
    const overlayHeight = overlayImages[0].height;
    const overlayOpacity = overlayImages[0].opacity;

    const viewState = {
      backgroundImage: bg_img,
      overlayImages: overlayImages,
      // Legacy properties for backward compatibility
      overlayImage: overlayImage,
      overlayImageEnabled: overlayImageEnabled,
      overlayImageX: overlayX,
      overlayImageY: overlayY,
      overlayImageWidth: overlayWidth,
      overlayImageHeight: overlayHeight,
      overlayImageOpacity: overlayOpacity,
      animationStyle: animation_style,
      hidePvAndBattery: hidePvAndBattery,
      title: { text: title_text, fontSize: header_font_size },
      batteryCard: {
        visible: false,
        x: 400,
        y: 200,
        width: 300,
        height: 100,
        powerLabel: '',
        powerValue: '',
        chargeLabel: '',
        chargeValue: '',
        dischargeLabel: '',
        dischargeValue: ''
      },
      pv: { fontSize: pv_font_size, lines: (hidePvAndBattery ? pvLines.map(line => ({ ...line, visible: false })) : pvLines).map(line => ({ ...line, fill: pvTextColor })) },
      socBar: (() => {
        const soc = Number(avg_soc);
        const safeSoc = Number.isFinite(soc) && soc >= 0 && soc <= 100 ? soc : 0;
        return { visible: !hidePvAndBattery, soc: safeSoc, ...getSocBarConfig(config) };
      })(),
      batterySoc: { text: hidePvAndBattery ? '' : `${Math.floor(avg_soc)}%`, fontSize: battery_font_size, fill: batteryTextColor, visible: !hidePvAndBattery },
      batteryPower: { text: hidePvAndBattery ? '' : this.formatPower(Math.abs(total_bat_w), use_kw), fontSize: battery_font_size, fill: batteryTextColor, visible: !hidePvAndBattery },
      battery: { fill: liquid_fill, isCharging: (invertBattery ? total_bat_w < 0 : total_bat_w > 0) },
      load: (() => {
        const loadFontSize = load_font_size; // Use unified font size
        const loadTextColor = resolveColor(config.load_text_color, '#00f1f2');
        return (loadLines && loadLines.length) ? { lines: loadLines.map(l => ({ ...l, fill: loadTextColor })), y: loadY, fontSize: loadFontSize, fill: loadTextColor } : { text: this.formatPower(houseTotalLoad, use_kw), fontSize: loadFontSize, fill: loadTextColor };
      })(),
      houseTemperature: {
        value: null,
        visible: false,
        fill: houseTextColor,
        fontSize: house_font_size
      },
      grid: { text: gridValueText, fontSize: grid_font_size, fill: gridTextColor },
      gridBox: (() => {
        const g = getGridBoxConfig(config);
        const w = g.width ?? 200;
        const h = g.height ?? 85;
        const scale = Math.min(w / 200, h / 85);
        const baseFontSize = g.fontSize !== null ? g.fontSize : Math.max(8, Math.round(12 * scale));
        const defaultTextColor = g.textColor || '#00f9f9';
        // Show Grid box only if grid sensors are configured
        // Show if sensor_grid_power is configured OR (sensor_grid_import OR sensor_grid_export)
        const hasGridPowerSensor = Boolean(config.sensor_grid_power && typeof config.sensor_grid_power === 'string' && config.sensor_grid_power.trim());
        const hasGridImportSensor = Boolean(config.sensor_grid_import && typeof config.sensor_grid_import === 'string' && config.sensor_grid_import.trim());
        const hasGridExportSensor = Boolean(config.sensor_grid_export && typeof config.sensor_grid_export === 'string' && config.sensor_grid_export.trim());
        const hasGridSensor = hasGridPowerSensor || hasGridImportSensor || hasGridExportSensor;
        
        // Use #00f9f9 as default color for grid box text (not gridImportColor/gridExportColor)
        const gridBoxTextColor = g.textColor || '#00f9f9';
        
        return {
          visible: hasGridSensor,
          ...g,
          fontSize: baseFontSize,
          lineHeight: 18 * scale,
          startY: 14 * scale,
          lines: [
            { label: label_importing || 'Import', value: this.formatPower(gridImport, use_kw), fill: gridBoxTextColor },
            { label: label_exporting || 'Export', value: this.formatPower(gridExport, use_kw), fill: gridBoxTextColor },
            { label: label_import_day, value: `${(gridImportDaily / 1000).toFixed(2)} kWh`, fill: gridBoxTextColor },
            { label: label_export_day, value: `${(gridExportDaily / 1000).toFixed(2)} kWh`, fill: gridBoxTextColor }
          ]
        };
      })(),
      pvBox: (() => {
        const p = getPvBoxConfig(config);
        const w = p.width ?? 200;
        const h = p.height ?? 85;
        const scale = Math.min(w / 200, h / 85);
        const baseFontSize = p.fontSize !== null ? p.fontSize : Math.max(8, Math.round(12 * scale));
        const dailyTotal = (Number(daily1) || 0) + (Number(daily2) || 0);
        const defaultTextColor = p.textColor || '#00f9f9';
        // Show PV box only if at least one array is configured (pvUiEnabled already checks this)
        return {
          visible: pvUiEnabled,
          ...p,
          fontSize: baseFontSize,
          lineHeight: 18 * scale,
          startY: 14 * scale,
          lines: [
            { label: label_pv_tot, value: this.formatPower(total_pv_w, use_kw), fill: defaultTextColor },
            { label: label_daily_production, value: `${(dailyTotal / 1000).toFixed(2)} kWh`, fill: defaultTextColor }
          ]
        };
      })(),
      heatPump: {
        text: hasHeatPumpSensor ? this.formatPower(heat_pump_w, use_kw) : '',
        fontSize: heat_pump_font_size,
        fill: heatPumpTextColor,
        visible: hasHeatPumpSensor
      },
      car1: car1View,
      car2: car2View,
      popup: {
        lines: popupPvValues.map((valueText, i) => (valueText ? `${popupPvNames[i]}: ${valueText}` : '')),
        hasContent: popupPvValues.some((valueText) => Boolean(valueText))
      },
      pvUiEnabled,
      flows,
      flowDurations,
      flowPaths,
      customTexts,
      solarForecast: this._solarForecastData || null,
      showDebugGrid
    };

    this._ensureTemplate(viewState);
    if (!this._domRefs) {
      this._cacheDomReferences();
      // Immediately cache flow path lengths to speed up animation initialization
      this._cacheFlowPathLengths();
    }
    this._updateView(viewState);
    // Apply flow animations immediately without any delays
    this._applyFlowAnimationTargets(viewState.flowDurations, viewState.flows);
    // Update text visibility based on motion sensor
    this._updateTextVisibility();
    this._prevViewState = this._snapshotViewState(viewState);
    this._forceRender = false;
  }

  _ensureTemplate(viewState) {
    // Rebuild only when forced (config change) or first run. Never rebuild on interval or
    // for dev-value updates — _updateView updates text positions without touching the image.
    if (this._rootInitialized && !this._forceRender) {
      return;
    }
    if (this._forceRender) {
      this._rootInitialized = false;
    }
    
    this.shadowRoot.innerHTML = this._buildTemplate(viewState);
    this._rootInitialized = true;
    this._cacheDomReferences();
  }

  _buildTemplate(viewState) {
    const config = this.config || {};
    
    // Language: config.language, else hass.locale (e.g. it-IT -> it), else en
    // Optimized: cache split and toLowerCase
    let lang = config.language;
    if (!lang && this._hass && this._hass.locale) {
      const locale = this._hass.locale;
      const dashIdx = locale.indexOf('-');
      lang = dashIdx > 0 ? locale.substring(0, dashIdx) : locale;
    }
    lang = (lang || 'en').toLowerCase();
    
    // Verify feature authorization using shared SHA-256 implementation
    // Define here because _buildTemplate is a separate method and doesn't have access to render() scope
    const verifyFeatureAuth = (inputValue) => {
      if (!inputValue || typeof inputValue !== 'string') return false;
      try {
        const trimmed = inputValue.trim();
        if (!trimmed) return false;
        const hashHex = LUMINA_SHA256(trimmed);
        const ok = LUMINA_AUTH_LIST && LUMINA_AUTH_LIST.includes(hashHex);
        if (LUMINA_AUTH_LIST === null) {
          LUMINA_REFRESH_AUTH(() => { this._forceRender = true; this.render(); });
        }
        return ok;
      } catch (e) { return false; }
    };
    
    // Get dynamic positions from config
    const TEXT_POSITIONS = getTextPositions(config);
    const POPUP_POSITIONS = getPopupPositions(config);
    
    // Build text transforms from dynamic positions
    const TEXT_TRANSFORMS = {
      solar: buildTextTransform(TEXT_POSITIONS.solar),
      battery: buildTextTransform(TEXT_POSITIONS.battery),
      home: buildTextTransform(TEXT_POSITIONS.home),
      home_temperature: buildTextTransform(TEXT_POSITIONS.home_temperature),
      grid: buildTextTransform(TEXT_POSITIONS.grid),
      heatPump: buildTextTransform(TEXT_POSITIONS.heatPump),
      car1_label: buildTextTransform(TEXT_POSITIONS.car1_label),
      car2_label: buildTextTransform(TEXT_POSITIONS.car2_label),
      car1_power: buildTextTransform(TEXT_POSITIONS.car1_power),
      car1_soc: buildTextTransform(TEXT_POSITIONS.car1_soc),
      car2_power: buildTextTransform(TEXT_POSITIONS.car2_power),
      car2_soc: buildTextTransform(TEXT_POSITIONS.car2_soc)
    };
    
    // Helper function to get transform string for flow offsets
    const getFlowTransform = (flowKey) => {
      let style = '';
      if (viewState.hidePvAndBattery && (flowKey === 'pv1' || flowKey === 'pv2' || flowKey === 'bat')) {
        style = 'display:none;';
      }
      
      if (!this._flowOffsets) {
        return style ? `style="${style}"` : '';
      }
      const offset = this._flowOffsets[flowKey];
      const transform = (offset && (offset.x !== 0 || offset.y !== 0)) ? `transform="translate(${offset.x}, ${offset.y})"` : '';
      
      if (style && transform) return `style="${style}" ${transform}`;
      if (style) return `style="${style}"`;
      return transform;
    };

    const SOC_BAR = viewState.socBar || {};
    
    // Helper function to calculate popup line positions
    const getPopupLinePos = (popup, lineIndex) => {
      const centerX = popup.x + popup.width / 2;
      const startY = popup.y + 25;
      const lineHeight = 15;
      return {
        textX: centerX,
        textY: startY + (lineIndex * lineHeight),
        toggleX: popup.x + popup.width - 20
      };
    };
    
    // Text visibility logic (must be defined before pvLineElements)
    const enableTextToggleButton = Boolean(this.config && this.config.enable_text_toggle_button);
    const textToggleButtonX = Math.max(0, Math.min(800, Number(this.config && this.config.text_toggle_button_x) || 30));
    // Handle Y position: if null/undefined or > 450 (viewBox height), use bottom positioning
    const rawY = this.config && this.config.text_toggle_button_y !== null && this.config.text_toggle_button_y !== undefined ? Number(this.config.text_toggle_button_y) : null;
    const textToggleButtonY = (rawY !== null && rawY <= 450) ? Math.max(0, Math.min(450, rawY)) : null;
    const textToggleButtonScale = Math.max(0.5, Math.min(2.0, Number(this.config && this.config.text_toggle_button_scale) || 1.0));
    const textVisibilitySensorId = this.config && this.config.text_visibility_sensor ? this.config.text_visibility_sensor.trim() : null;
    const authInput = config.pro_password;
    if (typeof verifyFeatureAuth !== 'function') {
      throw new Error('verifyFeatureAuth is not defined or not a function');
    }
    const isProEnabled = verifyFeatureAuth(authInput);
    const hasTextVisibilitySensor = isProEnabled && textVisibilitySensorId && this._hass && this._hass.states && this._hass.states[textVisibilitySensorId];
    
    // Check motion sensor (PRO feature); 60s keep-alive when shown by motion
    let motionDetected = false;
    if (hasTextVisibilitySensor) {
      const sensorState = this._hass.states[textVisibilitySensorId];
      const sensorValue = sensorState && sensorState.state ? String(sensorState.state).trim().toLowerCase() : '';
      const motionValues = ['on', 'active', 'detected', 'true', '1', 'yes', 'motion', 'occupied', 'open', 'present', 'person'];
      motionDetected = motionValues.includes(sensorValue);
      if (motionDetected) this._motionLastDetectedAt = Date.now();
    }
    const MOTION_KEEPALIVE_MS_RENDER = 60000;
    const motionVisibilityRender = hasTextVisibilitySensor && (
      motionDetected ||
      (this._motionLastDetectedAt != null && (Date.now() - this._motionLastDetectedAt) < MOTION_KEEPALIVE_MS_RENDER)
    );
    
    // Check if any entities are configured (if yes, texts should be visible automatically)
    // Optimized: inline check to avoid function call overhead
    const isSensorConfigured = (sensorValue) => {
      return sensorValue && typeof sensorValue === 'string' && sensorValue.trim().length > 0;
    };
    
    // Optimized: check custom texts with early exit
    let hasCustomText = false;
    for (let i = 1; i <= 5 && !hasCustomText; i++) {
      if (config[`custom_text_${i}_enabled`] === true) {
        const text = config[`custom_text_${i}_text`];
        const sensor = config[`custom_text_${i}_sensor`];
        if ((text && typeof text === 'string' && text.trim().length > 0) ||
            (sensor && typeof sensor === 'string' && sensor.trim().length > 0)) {
          hasCustomText = true;
        }
      }
    }
    
    // Optimized: check all sensors in a single pass with early exit
    const sensorKeys = [
      'sensor_home_load', 'sensor_home_load_secondary', 'sensor_pv_total', 'sensor_pv_total_secondary',
      'sensor_pv1', 'sensor_pv2', 'sensor_pv3', 'sensor_pv4', 'sensor_pv5', 'sensor_pv6',
      'sensor_pv_array2_1', 'sensor_pv_array2_2', 'sensor_pv_array2_3', 'sensor_pv_array2_4', 'sensor_pv_array2_5', 'sensor_pv_array2_6',
      'sensor_bat1_soc', 'sensor_bat1_power', 'sensor_bat2_soc', 'sensor_bat2_power',
      'sensor_bat3_soc', 'sensor_bat3_power', 'sensor_bat4_soc', 'sensor_bat4_power',
      'sensor_battery_flow', 'sensor_battery_charge', 'sensor_battery_discharge',
      'sensor_grid_power', 'sensor_grid_import', 'sensor_grid_export',
      'sensor_car_power', 'sensor_car_soc', 'sensor_car2_power', 'sensor_car2_soc',
      'sensor_heat_pump_consumption'
    ];
    let hasConfiguredEntities = hasCustomText;
    if (!hasConfiguredEntities) {
      for (let i = 0; i < sensorKeys.length && !hasConfiguredEntities; i++) {
        const val = config[sensorKeys[i]];
        if (val && typeof val === 'string' && val.trim().length > 0) {
          hasConfiguredEntities = true;
        }
      }
    }
    
    // Determine if texts should be visible (must match _updateTextVisibility logic)
    // Button: cycles through 3 states (0=all, 1=no grid/pv boxes/lines, 2=nothing). Motion: show for 60s then hide.
    let shouldShowTexts;
    let shouldShowBoxes;
    
    if (hasTextVisibilitySensor) {
      const motionActive = motionVisibilityRender;
      shouldShowTexts = (this._textsVisible !== 2) || motionActive;
      shouldShowBoxes = (this._textsVisible === 0) || motionActive;
    } else if (enableTextToggleButton) {
      // State 0: all visible, State 1: boxes hidden, State 2: all hidden
      shouldShowTexts = this._textsVisible !== 2;
      shouldShowBoxes = this._textsVisible === 0;
    } else {
      shouldShowTexts = hasConfiguredEntities;
      shouldShowBoxes = hasConfiguredEntities;
    }
    
    const car1Display = viewState.car1.visible ? 'inline' : 'none';
    const car1SocDisplay = viewState.car1.soc.visible ? 'inline' : 'none';
    const car2Display = viewState.car2.visible ? 'inline' : 'none';
    const car2SocDisplay = viewState.car2.soc.visible ? 'inline' : 'none';
    const pvLineElements = viewState.pv.lines.map((line, index) => {
      const display = line.visible ? 'inline' : 'none';
      const bg = calculateHolographicBackground(line.text, viewState.pv.fontSize, 80, 12);
      const iw = Math.max(20, bg.width - 6);
      const ih = Math.max(12, bg.height - 2);
      const ix = TEXT_POSITIONS.solar.x - iw / 2;
      const iy = line.y - ih / 2;
      return `<text data-role="pv-line-${index}" class="${shouldShowTexts ? '' : 'text-hidden'}" x="${TEXT_POSITIONS.solar.x}" y="${line.y}" transform="${TEXT_TRANSFORMS.solar}" fill="${line.fill || PEARL_WHITE}" font-family="${FONT_EXO2}" font-size="${viewState.pv.fontSize}" font-weight="bold" letter-spacing="1px" text-transform="uppercase" style="text-shadow: 0 0 4px rgba(245,243,238,0.5); text-anchor:middle; dominant-baseline:central; display:${display}; pointer-events: none;">${line.text}</text>`;
    }).join('');
    const batteryCardDisplay = viewState.batteryCard && viewState.batteryCard.visible ? 'inline' : 'none';
    const GRID_BOX = viewState.gridBox || {};
    const PV_BOX = viewState.pvBox || {};
    const pvClickableDisplay = viewState.pvUiEnabled ? 'inline' : 'none';
    const pvClickableCursor = viewState.pvUiEnabled ? 'pointer' : 'default';
    const enableEchoAlive = Boolean(this.config && this.config.enable_echo_alive);
    
    // Text button translations
    const activeTextLabels = {
      en: 'TEXT',
      it: 'TESTO',
      de: 'TEXT',
      fr: 'TEXTE',
      nl: 'TEKST'
    };
    const activeTextLabel = activeTextLabels[lang] || activeTextLabels.en;
    
    // Round buttons: 36x36 viewBox, scale via px
    const roundSize = 36;
    const btnSizePx = Math.max(32, Math.min(56, Math.round(40 * textToggleButtonScale)));
    const roundFontSize = 8;
    
    // Position: % relative to card (viewBox 800x450)
    const leftPct = (textToggleButtonX / 800 * 100).toFixed(2);
    const positionStyle = textToggleButtonY === null
      ? `left: ${leftPct}%; bottom: 2.2%;`
      : `left: ${leftPct}%; top: ${(textToggleButtonY / 450 * 100).toFixed(2)}%;`;
    
    const isEditorActive = this._isEditorActive();
    const showTextButton = enableTextToggleButton && !isEditorActive;
    const showHomeButton = !isEditorActive;
    
    const homeLabels = { en: 'HOME', it: 'CASA', de: 'HOME', fr: 'ACCUEIL', nl: 'HOME' };
    const homeLabel = homeLabels[lang] || homeLabels.en;
    
    const homeIcons = [
      { key: 'camera', path: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h10c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z', title: 'Camera' },
      { key: 'lights', path: 'M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74C19 5.14 15.86 2 12 2z', title: 'Lights' },
      { key: 'temperature', path: 'M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.76.69-3 2.44-3 4.41 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.97-1.24-3.72-3-4.41z', title: 'Temperature' },
      { key: 'security', path: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z', title: 'Security' },
      { key: 'humidity', path: 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0L12 2.69z', title: 'Humidity' }
    ];
    
    const roundBtn = (label, role, slot) => `
      <div class="lumina-round-btn" data-role="${role}" style="width: ${btnSizePx}px; height: ${btnSizePx}px; flex-shrink: 0; position: relative; overflow: hidden; cursor: pointer; pointer-events: auto;">
        <svg class="lumina-round-btn-svg" viewBox="0 0 ${roundSize} ${roundSize}" preserveAspectRatio="xMidYMid meet" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; pointer-events: none;">
          <circle cx="${roundSize/2}" cy="${roundSize/2}" r="${roundSize/2 - 1}" class="alive-box lumina-round-bg" />
          ${slot}
        </svg>
      </div>`;
    
    const iconBtn = (icon, index) => `
      <div class="lumina-round-btn lumina-round-btn--icon" data-role="home-icon-${icon.key}" data-home-icon="${icon.key}" style="flex-shrink: 0; position: relative; cursor: pointer; pointer-events: auto;">
        <svg viewBox="0 0 36 36" preserveAspectRatio="xMidYMid meet" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; pointer-events: none;">
          <defs><clipPath id="lumina-icon-clip-${icon.key}"><circle cx="18" cy="18" r="18"/></clipPath></defs>
          <g clip-path="url(#lumina-icon-clip-${icon.key})">
            <circle cx="18" cy="18" r="17" class="alive-box lumina-round-bg" />
            <g transform="translate(6,6)" fill="#00FFFF" fill-opacity="0.9"><path d="${icon.path}"/></g>
          </g>
        </svg>
      </div>`;
    
    const homePanelExpandedClass = this._homePanelExpanded ? ' home-collapsible-panel--expanded' : '';
    const textButtonBlock = showTextButton
      ? roundBtn(activeTextLabel, 'active-text-button-container', `<text x="${roundSize/2}" y="${roundSize/2 + 0.3}" class="alive-text" font-size="${roundFontSize}" font-weight="bold" text-anchor="middle" dominant-baseline="central" style="pointer-events: none;">${activeTextLabel}</text>`)
      : '';
    const echoAliveLabel = 'ECHO';
    const echoAliveButtonBlock = (enableEchoAlive && !isEditorActive) ? `<div class="lumina-round-btn echo-alive-container" data-role="echo-alive-container" style="width: ${btnSizePx}px; height: ${btnSizePx}px; flex-shrink: 0; position: relative; overflow: hidden; cursor: pointer; pointer-events: auto; border-radius: 50%;"><iframe class="echo-alive-iframe" src="https://Giorgio866.github.io/Alive-echo/?v=6" title="Echo Alive" data-role="echo-alive-iframe"></iframe><svg class="lumina-round-btn-svg" viewBox="0 0 ${roundSize} ${roundSize}" preserveAspectRatio="xMidYMid meet" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; pointer-events: none;"><circle cx="${roundSize/2}" cy="${roundSize/2}" r="${roundSize/2 - 1}" class="alive-box lumina-round-bg" /><text x="${roundSize/2}" y="${roundSize/2 + 0.3}" class="alive-text" font-size="${roundFontSize}" font-weight="bold" text-anchor="middle" dominant-baseline="central" style="pointer-events: none;">${echoAliveLabel}</text></svg></div>` : '';
    const luminaButtonsRow = showHomeButton ? `
        <div class="lumina-buttons-row" data-role="lumina-buttons-row" style="position: absolute; ${positionStyle} z-index: 1; display: flex; align-items: center; gap: 8px;">
          ${echoAliveButtonBlock}
          ${textButtonBlock}
          ${roundBtn(homeLabel, 'home-button-container', `<text x="${roundSize/2}" y="${roundSize/2 + 0.3}" class="alive-text" font-size="${roundFontSize}" font-weight="bold" text-anchor="middle" dominant-baseline="central" style="pointer-events: none;">${homeLabel}</text>`)}
          <div class="home-collapsible-panel${homePanelExpandedClass}" data-role="home-collapsible-panel" style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
            ${homeIcons.map((icon, i) => iconBtn(icon, i)).join('')}
          </div>
        </div>
      ` : '';

    return `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Exo+2:wght@400;600;700&family=Orbitron:wght@400;700;900&display=swap');
        :host { display: block; aspect-ratio: 16/9; container-type: inline-size; container-name: lumina-card; }
        ha-card { position: relative; height: 100%; overflow: hidden; background: transparent; border: none; box-shadow: none; }
        .track-path { stroke: #555555; stroke-width: 2px; fill: none; opacity: 0; pointer-events: none; }
        .flow-path { stroke-linecap: round; stroke-width: 3px; fill: none; opacity: 0; transition: opacity 0.35s ease; filter: none; pointer-events: none; }
        .flow-arrow { pointer-events: none; opacity: 0; transition: opacity 0.35s ease; }
        .debug-grid line { pointer-events: none; }
        .debug-grid text { pointer-events: none; font-family: sans-serif; }
        @keyframes pulse-cyan { 0% { filter: drop-shadow(0 0 2px #00FFFF); } 50% { filter: drop-shadow(0 0 10px #00FFFF); } 100% { filter: drop-shadow(0 0 2px #00FFFF); } }
        @keyframes pulse-cyan-round { 0%, 100% { box-shadow: 0 0 4px rgba(0,255,255,0.4), 0 0 12px rgba(0,255,255,0.25); } 50% { box-shadow: 0 0 10px rgba(0,255,255,0.6), 0 0 20px rgba(0,255,255,0.35); } }
        @keyframes soc-bar-pulse { 0% { opacity: 0.9; transform: scale(1); } 50% { opacity: 1; transform: scale(1.05); } 100% { opacity: 0.9; transform: scale(1); } }
        .soc-bar-pulse { animation: soc-bar-pulse 1.5s infinite ease-in-out; }
        .alive-box { animation: pulse-cyan 3s infinite ease-in-out; stroke: #00FFFF; stroke-width: 2px; fill: #001428; filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.6)) drop-shadow(0 0 8px rgba(0, 255, 255, 0.3)); }
        .alive-text { fill: #00FFFF; }
        .text-hidden { display: none !important; }
        .lumina-round-bg { stroke: #00FFFF; stroke-width: 2px; fill: #001428; filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5)); }
        .lumina-round-btn .lumina-round-bg,
        .lumina-round-btn--icon .lumina-round-bg,
        .echo-alive-container .lumina-round-bg { animation: none; filter: none; }
        .lumina-buttons-row { transform-origin: bottom left; }
        .lumina-round-btn { cursor: pointer; pointer-events: auto !important; touch-action: manipulation; border-radius: 50%; overflow: hidden; animation: pulse-cyan-round 3s infinite ease-in-out; box-shadow: 0 0 4px rgba(0,255,255,0.4), 0 0 12px rgba(0,255,255,0.25); }
        .lumina-round-btn:hover { animation: none; box-shadow: 0 0 8px rgba(0,255,255,0.5), 0 0 18px rgba(0,255,255,0.4); }
        .lumina-round-btn:hover .lumina-round-bg { filter: none; }
        .home-collapsible-panel { max-width: 0; transition: max-width 0.35s ease-out; }
        .home-collapsible-panel--expanded { max-width: 200px; overflow-x: auto !important; overflow-y: hidden !important; -webkit-overflow-scrolling: touch; }
        .lumina-round-btn--icon { width: 32px; height: 32px; border-radius: 50%; overflow: hidden; animation: pulse-cyan-round 3s infinite ease-in-out; box-shadow: 0 0 4px rgba(0,255,255,0.4), 0 0 12px rgba(0,255,255,0.25); }
        .lumina-round-btn--icon:hover { animation: none; box-shadow: 0 0 8px rgba(0,255,255,0.5), 0 0 18px rgba(0,255,255,0.4); }
        .lumina-round-btn--icon:hover .lumina-round-bg { filter: none; }
        .echo-alive-container { animation: pulse-cyan-round 3s infinite ease-in-out; box-shadow: 0 0 4px rgba(0,255,255,0.4), 0 0 12px rgba(0,255,255,0.25); }
        .echo-alive-container:hover { animation: none; box-shadow: 0 0 8px rgba(0,255,255,0.5), 0 0 18px rgba(0,255,255,0.4); }
        .echo-alive-container:hover .lumina-round-bg { filter: none; }
        @container lumina-card (max-width: 600px) {
          .lumina-buttons-row { gap: 4px !important; max-width: 100%; overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; }
          .lumina-buttons-row .lumina-round-btn,
          .lumina-buttons-row .echo-alive-container {
            width: min(40px, 5.5cqw) !important;
            height: min(40px, 5.5cqw) !important;
            min-width: 24px !important;
            min-height: 24px !important;
            flex-shrink: 0;
          }
          .lumina-buttons-row .lumina-round-btn--icon {
            width: min(28px, 4.5cqw) !important;
            height: min(28px, 4.5cqw) !important;
            min-width: 20px !important;
            min-height: 20px !important;
            flex-shrink: 0;
          }
          .home-collapsible-panel--expanded { max-width: 140px !important; }
        }
        @container lumina-card (max-width: 420px) {
          .lumina-buttons-row .lumina-round-btn,
          .lumina-buttons-row .echo-alive-container {
            width: min(36px, 5.5cqw) !important;
            height: min(36px, 5.5cqw) !important;
            min-width: 22px !important;
            min-height: 22px !important;
          }
          .lumina-buttons-row .lumina-round-btn--icon {
            width: min(24px, 4.5cqw) !important;
            height: min(24px, 4.5cqw) !important;
            min-width: 18px !important;
            min-height: 18px !important;
          }
          .home-collapsible-panel--expanded { max-width: 120px !important; }
        }
        @container lumina-card (max-width: 320px) {
          .lumina-buttons-row .lumina-round-btn,
          .lumina-buttons-row .echo-alive-container {
            width: 22px !important;
            height: 22px !important;
            min-width: 20px !important;
            min-height: 20px !important;
          }
          .lumina-buttons-row .lumina-round-btn--icon {
            width: 20px !important;
            height: 20px !important;
            min-width: 18px !important;
            min-height: 18px !important;
          }
          .home-collapsible-panel--expanded { max-width: 110px !important; }
        }
        @media (max-width: 600px) {
          .lumina-buttons-row { gap: 4px !important; max-width: 100%; overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; }
        }
        /* Responsive: button scales with card on small devices; hidden in HA visual editor */
        ha-card {
          position: relative;
          contain: layout style paint;
        }
        [data-role*="-popup"] rect { transition: all 0.2s ease; }
        [data-role*="-popup-toggle"] rect { transition: fill 0.3s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease; stroke: #00FFFF !important; opacity: 0.3 !important; }
        [data-role*="-popup-toggle"] circle { transition: cx 0.3s cubic-bezier(0.4, 0, 0.2, 1), fill 0.3s ease, opacity 0.3s ease; opacity: 0.9 !important; }
        [data-role*="-popup-toggle"]:hover rect { filter: brightness(1.2); }
        [data-role*="-popup-toggle"]:hover circle { filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.5)); }
        .title-text { fill: #00FFFF; font-weight: 900; font-family: 'Orbitron', sans-serif; text-anchor: middle; letter-spacing: 3px; text-transform: uppercase; }
        /* Editor helpers */
        .editor-divider { border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 20px 0 10px 0; }
        /* Visual header for Array 2: use a dedicated class so no styles are inherited */
        .array2-header { display: block; }
        .array2-visual-header {
          font-weight: bold !important;
          font-size: 1.05em !important;
          padding: 12px 16px !important;
          color: var(--primary-color) !important;
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          cursor: default !important;
          list-style: none !important;
          background: transparent !important;
          box-shadow: none !important;
          border: none !important;
        }
        .array2-visual-header + .field-helper { margin: 0 0 12px 16px; color: var(--secondary-text-color); font-size: 0.9em; }
        /* Ensure no disclosure marker/caret appears on the visual header */
        .array2-visual-header::after,
        .array2-visual-header::marker,
        .array2-visual-header::-webkit-details-marker { content: '' !important; display: none !important; }
        .debug-coordinates {
          position: absolute;
          top: 12px;
          left: 12px;
          padding: 6px 10px;
          background: rgba(0, 20, 40, 0.85);
          border: 1px solid #00FFFF;
          border-radius: 4px;
          font-family: 'Orbitron', sans-serif;
          font-size: 12px;
          letter-spacing: 1px;
          color: #00FFFF;
          pointer-events: none;
          text-transform: uppercase;
          display: none;
        }
        /* Echo Alive: round button (first in row); iframe hidden, keeps Silk alive. Pulse via box-shadow (round). */
        .echo-alive-container {
          overflow: hidden;
          transform-origin: center;
        }
        .echo-alive-container.clicked {
          animation: echoAlivePulse 0.5s ease;
        }
        @keyframes echoAlivePulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
        .echo-alive-iframe {
          position: absolute;
          left: 0;
          top: 0;
          width: 1px;
          height: 1px;
          opacity: 0;
          pointer-events: none;
          border: none;
          z-index: -1;
        }
      </style>
      <ha-card>
        <svg viewBox="0 0 800 450" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="width: 100%; height: 100%;">
          <defs>
            <linearGradient id="soc-bar-on-grad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stop-color="${SOC_BAR.colorOn ?? '#00FFFF'}" stop-opacity="0.85"/>
              <stop offset="1" stop-color="${SOC_BAR.colorOn ?? '#00FFFF'}" stop-opacity="1"/>
            </linearGradient>
            ${(() => {
              const solarForecast = viewState.solarForecast;
              if (!solarForecast || !solarForecast.enabled) return '';
              
              const percentageRaw = Number(solarForecast.percentage);
              const percentage = Number.isFinite(percentageRaw) ? Math.max(0, Math.min(100, percentageRaw)) : 0;
              const opacity = Math.max(0.1, Math.min(1.0, 0.4 + (percentage / 100 * 0.6)));
              const baseColor = resolveColor(solarForecast.color, '#00FFFF');
              
              return `
            <radialGradient id="solar-forecast-gradient" cx="50%" cy="50%" r="50%">
              <stop offset="0%" style="stop-color:${baseColor};stop-opacity:${opacity}" />
              <stop offset="70%" style="stop-color:${baseColor};stop-opacity:${opacity * 0.8}" />
              <stop offset="100%" style="stop-color:${baseColor};stop-opacity:${opacity * 0.3}" />
            </radialGradient>`;
            })()}
          </defs>

          <image data-role="background-image" href="${viewState.backgroundImage}" xlink:href="${viewState.backgroundImage}" x="0" y="0" width="800" height="450" preserveAspectRatio="none" />
          <g data-role="debug-grid" class="debug-grid" style="display:none;">
            ${DEBUG_GRID_CONTENT}
          </g>

          ${viewState.title && viewState.title.text ? `
          <rect x="290" y="10" width="220" height="32" rx="6" ry="6" fill="rgba(0, 20, 40, 0.85)" stroke="#00FFFF" stroke-width="1.5"/>
          <text data-role="title-text" class="title-text ${shouldShowTexts ? '' : 'text-hidden'}" x="400" y="32" font-size="${viewState.title.fontSize}">${viewState.title.text}</text>
          ` : ''}

          <g data-role="grid-box" class="${shouldShowBoxes ? '' : 'text-hidden'}" transform="translate(${GRID_BOX.x ?? 580}, ${GRID_BOX.y ?? 15})" style="display:${GRID_BOX.visible ? 'inline' : 'none'}; pointer-events: none;">
            <rect x="0" y="0" width="${GRID_BOX.width ?? 200}" height="${GRID_BOX.height ?? 85}" rx="10" ry="10" class="alive-box" />
            ${(GRID_BOX.lines || []).map((line, i) => {
              const fy = (GRID_BOX.startY ?? 14) + i * (GRID_BOX.lineHeight ?? 18);
              const fs = GRID_BOX.fontSize ?? 12;
              const fillColor = line.fill || '#00f9f9';
              return `<text data-role="grid-box-line-${i}" class="${shouldShowBoxes ? '' : 'text-hidden'}" x="${(GRID_BOX.width ?? 200) / 2}" y="${fy}" fill="${fillColor}" font-family="sans-serif" font-size="${fs}" text-anchor="middle" dominant-baseline="central">${line.label}: ${line.value}</text>`;
            }).join('')}
          </g>
          <g data-role="pv-box" class="${shouldShowBoxes ? '' : 'text-hidden'}" transform="translate(${PV_BOX.x ?? 20}, ${PV_BOX.y ?? 15})" style="display:${PV_BOX.visible ? 'inline' : 'none'}; pointer-events: none;">
            <rect x="0" y="0" width="${PV_BOX.width ?? 200}" height="${PV_BOX.height ?? 85}" rx="10" ry="10" class="alive-box" />
            ${(PV_BOX.lines || []).map((line, i) => {
              const fy = (PV_BOX.startY ?? 14) + i * (PV_BOX.lineHeight ?? 18);
              const fs = PV_BOX.fontSize ?? 12;
              const fillColor = line.fill || '#00f9f9';
              return `<text data-role="pv-box-line-${i}" class="${shouldShowBoxes ? '' : 'text-hidden'}" x="${(PV_BOX.width ?? 200) / 2}" y="${fy}" fill="${fillColor}" font-family="sans-serif" font-size="${fs}" text-anchor="middle" dominant-baseline="central">${line.label}: ${line.value}</text>`;
            }).join('')}
          </g>

          <g ${getFlowTransform('pv1')}>
          <path class="track-path" d="${viewState.flowPaths.pv1}" />
          <path class="flow-path" data-flow-key="pv1" ${viewState.flows.pv1.direction === -1 ? 'data-flow-dir="reverse"' : ''} d="${viewState.flowPaths.pv1}" stroke="${viewState.flows.pv1.stroke}" pathLength="100" style="opacity:0;" />
          ${buildArrowGroupSvg('pv1', viewState.flows.pv1)}
          </g>
          <g ${getFlowTransform('pv2')}>
          <path class="track-path" d="${viewState.flowPaths.pv2}" />
          <path class="flow-path" data-flow-key="pv2" ${viewState.flows.pv2.direction === -1 ? 'data-flow-dir="reverse"' : ''} d="${viewState.flowPaths.pv2}" stroke="${viewState.flows.pv2.stroke}" pathLength="100" style="opacity:0;" />
          ${buildArrowGroupSvg('pv2', viewState.flows.pv2)}
          </g>
          <g ${getFlowTransform('bat')}>
          <path class="track-path" d="${viewState.flowPaths.bat}" />
          <path class="flow-path" data-flow-key="bat" d="${viewState.flowPaths.bat}" stroke="${viewState.flows.bat.stroke}" pathLength="100" style="opacity:0;" />
          ${buildArrowGroupSvg('bat', viewState.flows.bat)}
          </g>
          <g ${getFlowTransform('load')}>
          <path class="track-path" d="${viewState.flowPaths.load}" />
          <path class="flow-path" data-flow-key="load" d="${viewState.flowPaths.load}" stroke="${viewState.flows.load.stroke}" pathLength="100" style="opacity:0;" />
          ${buildArrowGroupSvg('load', viewState.flows.load)}
          </g>
          <g ${getFlowTransform('grid')}>
          <path class="track-path" d="${viewState.flowPaths.grid}" />
          <path class="flow-path" data-flow-key="grid" d="${viewState.flowPaths.grid}" stroke="${viewState.flows.grid.stroke}" pathLength="100" style="opacity:0;" />
          ${buildArrowGroupSvg('grid', viewState.flows.grid)}
          </g>
          <g ${getFlowTransform('grid_house')}>
          <path class="track-path" d="${viewState.flowPaths.grid_house}" />
          <path class="flow-path" data-flow-key="grid_house" d="${viewState.flowPaths.grid_house}" stroke="${viewState.flows.grid_house.stroke}" pathLength="100" style="opacity:0;" />
          ${buildArrowGroupSvg('grid_house', viewState.flows.grid_house)}
          </g>
          <g ${getFlowTransform('car1')}>
          <path class="track-path" d="${viewState.flowPaths.car1}" />
          <path class="flow-path" data-flow-key="car1" d="${viewState.flowPaths.car1}" stroke="${viewState.flows.car1.stroke}" pathLength="100" style="opacity:0;" />
          ${buildArrowGroupSvg('car1', viewState.flows.car1)}
          </g>
          <g ${getFlowTransform('car2')}>
          <path class="track-path" d="${viewState.flowPaths.car2}" />
          <path class="flow-path" data-flow-key="car2" d="${viewState.flowPaths.car2}" stroke="${viewState.flows.car2.stroke}" pathLength="100" style="opacity:0;" />
          ${buildArrowGroupSvg('car2', viewState.flows.car2)}
          </g>
          <g ${getFlowTransform('heatPump')}>
          <path class="track-path" d="${viewState.flowPaths.heatPump}" />
          <path class="flow-path" data-flow-key="heatPump" d="${viewState.flowPaths.heatPump}" stroke="${viewState.flows.heatPump.stroke}" pathLength="100" style="opacity:0;" />
          ${buildArrowGroupSvg('heatPump', viewState.flows.heatPump)}
          </g>
          ${(() => {
            let customFlowsHtml = '';
            for (let i = 1; i <= 5; i++) {
              const flowKey = `custom_flow_${i}`;
              const flowState = viewState.flows[flowKey];
              if (!flowState) continue;
              
              // Use config if available, otherwise assume enabled if we have state
              const isEnabled = config[`custom_flow_${i}_enabled`] !== false;
              // Show only if enabled AND active (will be updated dynamically in _updateView)
              const isActive = flowState.active === true;
              
              customFlowsHtml += `
          <g ${getFlowTransform(flowKey)} data-custom-flow-group="${i}" style="display:${(isEnabled && isActive) ? 'inline' : 'none'};">
          <path class="track-path" d="${viewState.flowPaths[flowKey]}" />
          <path class="flow-path" data-flow-key="${flowKey}" d="${viewState.flowPaths[flowKey]}" stroke="${flowState.stroke}" pathLength="100" style="opacity:0;" />
          ${buildArrowGroupSvg(flowKey, flowState)}
          </g>`;
            }
            return customFlowsHtml;
          })()}

          ${viewState.customTexts.map(ct => `
          <text data-role="custom-text-${ct.id}" class="${shouldShowTexts ? '' : 'text-hidden'}" x="${ct.x}" y="${ct.y}" fill="${ct.color}" font-size="${ct.size}" style="font-family: Arial, sans-serif; text-anchor: middle; pointer-events: none;">${ct.text}</text>
          `).join('')}

          ${(() => {
            const solarForecast = viewState.solarForecast;
            if (!solarForecast || !solarForecast.enabled) return '';
            
            const percentageRaw = Number(solarForecast.percentage);
            const percentage = Number.isFinite(percentageRaw) ? Math.max(0, Math.min(100, percentageRaw)) : 0;
            
            const x = Number(solarForecast.x) || 400;
            const y = Number(solarForecast.y) || 350;
            
            // Calculate size based on percentage (min 20px, max 60px)
            const baseSize = 30;
            const sizeVariation = (percentage / 100) * 20; // 0-20px variation
            const sunSize = Math.max(20, Math.min(60, baseSize + sizeVariation));
            const sunRadius = sunSize / 2;
            
            // Calculate opacity based on percentage (min 0.4, max 1.0)
            const opacity = Math.max(0.1, Math.min(1.0, 0.4 + (percentage / 100 * 0.6)));
            
            // Calculate glow intensity based on percentage
            const glowSize = Math.max(2, Math.min(20, 5 + (percentage / 100 * 15))); // 5-20px glow
            
            // Use configured color (cyan by default)
            const sunColor = resolveColor(solarForecast.color, '#00FFFF');
            
            // Create sun rays (8 rays)
            const rayCount = 8;
            const rayLength = sunRadius * 0.6;
            const rayWidth = 2;
            let raysSvg = '';
            for (let i = 0; i < rayCount; i++) {
              const angle = (i * 360 / rayCount) * Math.PI / 180;
              const startX = x + Math.cos(angle) * sunRadius;
              const startY = y + Math.sin(angle) * sunRadius;
              const endX = x + Math.cos(angle) * (sunRadius + rayLength);
              const endY = y + Math.sin(angle) * (sunRadius + rayLength);
              raysSvg += `<line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" stroke="${sunColor}" stroke-width="${rayWidth}" opacity="${opacity * 0.7}" stroke-linecap="round" />`;
            }
            
            return `
          <g data-role="solar-forecast-sun" class="${shouldShowTexts ? '' : 'text-hidden'}" style="filter: drop-shadow(0 0 ${glowSize}px ${sunColor}) drop-shadow(0 0 ${glowSize * 0.5}px ${sunColor});">
            ${raysSvg}
            <circle cx="${x}" cy="${y}" r="${sunRadius}" fill="url(#solar-forecast-gradient)" opacity="${opacity}" />
            <circle cx="${x}" cy="${y}" r="${sunRadius * 0.7}" fill="${sunColor}" opacity="${opacity * 0.5}" />
          </g>`;
          })()}

          ${pvLineElements}

          <text data-role="battery-soc" class="${shouldShowTexts ? '' : 'text-hidden'}" x="${TEXT_POSITIONS.battery.x}" y="${TEXT_POSITIONS.battery.y}" transform="${TEXT_TRANSFORMS.battery}" fill="${viewState.batterySoc.fill || PEARL_WHITE}" font-family="${FONT_EXO2}" font-size="${viewState.batterySoc.fontSize}" font-weight="bold" letter-spacing="2px" text-transform="uppercase" style="text-shadow: 0 0 4px rgba(245,243,238,0.5); text-anchor:middle; dominant-baseline:central; display:${viewState.batterySoc.visible !== false ? 'inline' : 'none'}">${viewState.batterySoc.text}</text>

          <text data-role="battery-power" class="${shouldShowTexts ? '' : 'text-hidden'}" x="${TEXT_POSITIONS.battery.x}" y="${TEXT_POSITIONS.battery.y + 20}" transform="${TEXT_TRANSFORMS.battery}" fill="${viewState.batteryPower.fill || PEARL_WHITE}" font-family="${FONT_EXO2}" font-size="${viewState.batteryPower.fontSize}" font-weight="bold" letter-spacing="3px" text-transform="uppercase" style="text-shadow: 0 0 4px rgba(245,243,238,0.5); text-anchor:middle; dominant-baseline:central; display:${viewState.batteryPower.visible !== false ? 'inline' : 'none'}">${viewState.batteryPower.text}</text>

          <text data-role="load-power" class="${shouldShowTexts ? '' : 'text-hidden'}" x="${TEXT_POSITIONS.home.x}" y="${TEXT_POSITIONS.home.y}" transform="${TEXT_TRANSFORMS.home}" fill="${viewState.load.fill || PEARL_WHITE}" font-family="${FONT_EXO2}" font-size="${viewState.load.fontSize}" font-weight="bold" letter-spacing="2px" text-transform="uppercase" style="text-shadow: 0 0 4px rgba(245,243,238,0.5); text-anchor:middle; dominant-baseline:central;">${viewState.load.text || ''}</text>
          <text data-role="load-line-0" x="${TEXT_POSITIONS.home.x}" y="${TEXT_POSITIONS.home.y}" transform="${TEXT_TRANSFORMS.home}" fill="${viewState.load.fill || PEARL_WHITE}" font-size="${viewState.load.fontSize}" style="${TXT_STYLE}; display:none;"></text>
          <text data-role="load-line-1" x="${TEXT_POSITIONS.home.x}" y="${TEXT_POSITIONS.home.y}" transform="${TEXT_TRANSFORMS.home}" fill="${viewState.load.fill || PEARL_WHITE}" font-size="${viewState.load.fontSize}" style="${TXT_STYLE}; display:none;"></text>
          <text data-role="load-line-2" x="${TEXT_POSITIONS.home.x}" y="${TEXT_POSITIONS.home.y}" transform="${TEXT_TRANSFORMS.home}" fill="${viewState.load.fill || PEARL_WHITE}" font-size="${viewState.load.fontSize}" style="${TXT_STYLE}; display:none;"></text>
          <text data-role="heat-pump-power" class="${shouldShowTexts ? '' : 'text-hidden'}" x="${TEXT_POSITIONS.heatPump.x}" y="${TEXT_POSITIONS.heatPump.y}" transform="${TEXT_TRANSFORMS.heatPump}" fill="${viewState.heatPump.fill || PEARL_WHITE}" font-family="${FONT_EXO2}" font-size="${viewState.heatPump.fontSize}" font-weight="bold" letter-spacing="2px" text-transform="uppercase" style="text-shadow: 0 0 4px rgba(245,243,238,0.5); text-anchor:middle; dominant-baseline:central; display:${viewState.heatPump.visible ? 'inline' : 'none'};">${viewState.heatPump.text}</text>
          <text data-role="grid-power" class="${shouldShowTexts ? '' : 'text-hidden'}" x="${TEXT_POSITIONS.grid.x}" y="${TEXT_POSITIONS.grid.y}" transform="${TEXT_TRANSFORMS.grid}" fill="${viewState.grid.fill || PEARL_WHITE}" font-family="${FONT_EXO2}" font-size="${viewState.grid.fontSize}" font-weight="bold" letter-spacing="2px" text-transform="uppercase" style="text-shadow: 0 0 4px rgba(245,243,238,0.5); text-anchor:middle; dominant-baseline:central;">${viewState.grid.text}</text>

          <text data-role="car1-label" class="${shouldShowTexts ? '' : 'text-hidden'}" x="${TEXT_POSITIONS.car1_label.x}" y="${TEXT_POSITIONS.car1_label.y}" transform="${TEXT_TRANSFORMS.car1_label}" fill="${viewState.car1.label.fill || PEARL_WHITE}" font-family="${FONT_EXO2}" font-size="${viewState.car1.label.fontSize}" font-weight="bold" letter-spacing="1px" text-transform="uppercase" style="text-shadow: 0 0 4px rgba(245,243,238,0.5); text-anchor:middle; dominant-baseline:central; display:${car1Display};">${viewState.car1.label.text}</text>
          <text data-role="car1-power" class="${shouldShowTexts ? '' : 'text-hidden'}" x="${TEXT_POSITIONS.car1_power.x}" y="${TEXT_POSITIONS.car1_power.y}" transform="${TEXT_TRANSFORMS.car1_power}" fill="${viewState.car1.power.fill || PEARL_WHITE}" font-family="${FONT_EXO2}" font-size="${viewState.car1.power.fontSize}" font-weight="bold" letter-spacing="2px" text-transform="uppercase" style="text-shadow: 0 0 4px rgba(245,243,238,0.5); text-anchor:middle; dominant-baseline:central; display:${car1Display};">${viewState.car1.power.text}</text>
          <text data-role="car1-soc" class="${shouldShowTexts ? '' : 'text-hidden'}" x="${TEXT_POSITIONS.car1_soc.x}" y="${TEXT_POSITIONS.car1_soc.y}" transform="${TEXT_TRANSFORMS.car1_soc}" fill="${viewState.car1.soc.fill || PEARL_WHITE}" font-family="${FONT_EXO2}" font-size="${viewState.car1.soc.fontSize}" font-weight="bold" letter-spacing="2px" text-transform="uppercase" style="text-shadow: 0 0 4px rgba(245,243,238,0.5); text-anchor:middle; dominant-baseline:central; display:${car1SocDisplay};">${viewState.car1.soc.text}</text>

          <text data-role="car2-label" class="${shouldShowTexts ? '' : 'text-hidden'}" x="${TEXT_POSITIONS.car2_label.x}" y="${TEXT_POSITIONS.car2_label.y}" transform="${TEXT_TRANSFORMS.car2_label}" fill="${viewState.car2.label.fill || PEARL_WHITE}" font-family="${FONT_EXO2}" font-size="${viewState.car2.label.fontSize}" font-weight="bold" letter-spacing="1px" text-transform="uppercase" style="text-shadow: 0 0 4px rgba(245,243,238,0.5); text-anchor:middle; dominant-baseline:central; display:${car2Display};">${viewState.car2.label.text}</text>
          <text data-role="car2-power" class="${shouldShowTexts ? '' : 'text-hidden'}" x="${TEXT_POSITIONS.car2_power.x}" y="${TEXT_POSITIONS.car2_power.y}" transform="${TEXT_TRANSFORMS.car2_power}" fill="${viewState.car2.power.fill || PEARL_WHITE}" font-family="${FONT_EXO2}" font-size="${viewState.car2.power.fontSize}" font-weight="bold" letter-spacing="2px" text-transform="uppercase" style="text-shadow: 0 0 4px rgba(245,243,238,0.5); text-anchor:middle; dominant-baseline:central; display:${car2Display};">${viewState.car2.power.text}</text>
          <text data-role="car2-soc" class="${shouldShowTexts ? '' : 'text-hidden'}" x="${TEXT_POSITIONS.car2_soc.x}" y="${TEXT_POSITIONS.car2_soc.y}" transform="${TEXT_TRANSFORMS.car2_soc}" fill="${viewState.car2.soc.fill || PEARL_WHITE}" font-family="${FONT_EXO2}" font-size="${viewState.car2.soc.fontSize}" font-weight="bold" letter-spacing="2px" text-transform="uppercase" style="text-shadow: 0 0 4px rgba(245,243,238,0.5); text-anchor:middle; dominant-baseline:central; display:${car2SocDisplay};">${viewState.car2.soc.text}</text>

          <g data-role="pv-popup" style="display:none; cursor:pointer;">
            <rect x="${POPUP_POSITIONS.pv.x}" y="${POPUP_POSITIONS.pv.y}" width="${POPUP_POSITIONS.pv.width}" height="${POPUP_POSITIONS.pv.height}" rx="10" ry="10" class="alive-box" />
            <g data-role="pv-popup-line-0-group" style="display:none;">
              <text data-role="pv-popup-line-0" x="${getPopupLinePos(POPUP_POSITIONS.pv, 0).textX}" y="${getPopupLinePos(POPUP_POSITIONS.pv, 0).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="pv-popup-toggle-0" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.pv, 0).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.pv, 0).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="pv-popup-line-1-group" style="display:none;">
              <text data-role="pv-popup-line-1" x="${getPopupLinePos(POPUP_POSITIONS.pv, 1).textX}" y="${getPopupLinePos(POPUP_POSITIONS.pv, 1).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="pv-popup-toggle-1" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.pv, 1).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.pv, 1).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="pv-popup-line-2-group" style="display:none;">
              <text data-role="pv-popup-line-2" x="${getPopupLinePos(POPUP_POSITIONS.pv, 2).textX}" y="${getPopupLinePos(POPUP_POSITIONS.pv, 2).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="pv-popup-toggle-2" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.pv, 2).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.pv, 2).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="pv-popup-line-3-group" style="display:none;">
              <text data-role="pv-popup-line-3" x="${getPopupLinePos(POPUP_POSITIONS.pv, 3).textX}" y="${getPopupLinePos(POPUP_POSITIONS.pv, 3).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="pv-popup-toggle-3" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.pv, 3).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.pv, 3).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="pv-popup-line-4-group" style="display:none;">
              <text data-role="pv-popup-line-4" x="${getPopupLinePos(POPUP_POSITIONS.pv, 4).textX}" y="${getPopupLinePos(POPUP_POSITIONS.pv, 4).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="pv-popup-toggle-4" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.pv, 4).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.pv, 4).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="pv-popup-line-5-group" style="display:none;">
              <text data-role="pv-popup-line-5" x="${getPopupLinePos(POPUP_POSITIONS.pv, 5).textX}" y="${getPopupLinePos(POPUP_POSITIONS.pv, 5).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="pv-popup-toggle-5" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.pv, 5).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.pv, 5).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
          </g>

          <g data-role="battery-popup" style="display:none; cursor:pointer;">
            <rect x="${POPUP_POSITIONS.battery.x}" y="${POPUP_POSITIONS.battery.y}" width="${POPUP_POSITIONS.battery.width}" height="${POPUP_POSITIONS.battery.height}" rx="10" ry="10" class="alive-box" />
            <g data-role="battery-popup-line-0-group" style="display:none;">
              <text data-role="battery-popup-line-0" x="${getPopupLinePos(POPUP_POSITIONS.battery, 0).textX}" y="${getPopupLinePos(POPUP_POSITIONS.battery, 0).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="battery-popup-toggle-0" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.battery, 0).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.battery, 0).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="battery-popup-line-1-group" style="display:none;">
              <text data-role="battery-popup-line-1" x="${getPopupLinePos(POPUP_POSITIONS.battery, 1).textX}" y="${getPopupLinePos(POPUP_POSITIONS.battery, 1).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="battery-popup-toggle-1" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.battery, 1).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.battery, 1).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="battery-popup-line-2-group" style="display:none;">
              <text data-role="battery-popup-line-2" x="${getPopupLinePos(POPUP_POSITIONS.battery, 2).textX}" y="${getPopupLinePos(POPUP_POSITIONS.battery, 2).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="battery-popup-toggle-2" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.battery, 2).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.battery, 2).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="battery-popup-line-3-group" style="display:none;">
              <text data-role="battery-popup-line-3" x="${getPopupLinePos(POPUP_POSITIONS.battery, 3).textX}" y="${getPopupLinePos(POPUP_POSITIONS.battery, 3).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="battery-popup-toggle-3" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.battery, 3).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.battery, 3).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="battery-popup-line-4-group" style="display:none;">
              <text data-role="battery-popup-line-4" x="${getPopupLinePos(POPUP_POSITIONS.battery, 4).textX}" y="${getPopupLinePos(POPUP_POSITIONS.battery, 4).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="battery-popup-toggle-4" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.battery, 4).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.battery, 4).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="battery-popup-line-5-group" style="display:none;">
              <text data-role="battery-popup-line-5" x="${getPopupLinePos(POPUP_POSITIONS.battery, 5).textX}" y="${getPopupLinePos(POPUP_POSITIONS.battery, 5).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="battery-popup-toggle-5" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.battery, 5).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.battery, 5).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
          </g>

          <polygon data-role="battery-clickable-area" points="325,400 350,375 350,275 275,250 250,250 250,350 325,400" fill="transparent" style="cursor:pointer;" />

          <path data-role="linea-box-1" class="${shouldShowTexts ? '' : 'text-hidden'}" d="${config.linea_box_1_path || 'M 664,130 730,95 V 82'}" stroke="#00f9f9" stroke-width="1" fill="none" style="display:${GRID_BOX.visible ? 'inline' : 'none'}; pointer-events: none;" />
          <path data-role="linea-box-2" class="${shouldShowTexts ? '' : 'text-hidden'}" d="${config.linea_box_2_path || 'M 17,200 8.9,190 9.2,123 89,75'}" stroke="#00f9f9" stroke-width="1" fill="none" style="display:${PV_BOX.visible ? 'inline' : 'none'}; pointer-events: none;" />

          <g data-role="soc-bar" transform="translate(${SOC_BAR.x ?? 325}, ${SOC_BAR.y ?? 277}) translate(${(SOC_BAR.width ?? 30) / 2}, ${(SOC_BAR.height ?? 85) / 2}) rotate(${SOC_BAR.rotate ?? 1}) skewX(${SOC_BAR.skewX ?? 2}) skewY(${SOC_BAR.skewY ?? -19}) translate(${-((SOC_BAR.width ?? 30) / 2)}, ${-((SOC_BAR.height ?? 85) / 2)})" style="display:${(SOC_BAR.visible !== false && !viewState.hidePvAndBattery) ? 'inline' : 'none'}; pointer-events: none;">
            <rect class="soc-bar-back" x="0" y="0" width="${SOC_BAR.width ?? 30}" height="${SOC_BAR.height ?? 85}" rx="4" ry="4" fill="rgba(0,25,45,0.75)" stroke="rgba(255,255,255,0.2)" stroke-width="1" style="pointer-events: none;" />
            ${[0,1,2,3,4,5].map(i => {
              const thresh = (6 - i) * (100 / 6);
              const lit = (SOC_BAR.soc ?? 0) >= thresh;
              const isFirstSegment = (i === 5);
              const colorOn = SOC_BAR.colorOn ?? '#00FFFF';
              const colorOff = SOC_BAR.colorOff ?? '#5aa7c3';
              const fill = lit ? (isFirstSegment ? '#E53935' : `url(#soc-bar-on-grad)`) : colorOff;
              const segH = ((SOC_BAR.height ?? 85) - 7) / 6;
              const y = 1 + i * (segH + 1);
              const glow = SOC_BAR.glow ?? 13;
              const glowColor = isFirstSegment && lit ? '#E53935' : colorOn;
              const filter = lit && glow > 0 ? `drop-shadow(0 0 ${glow}px ${glowColor}) drop-shadow(0 0 ${Math.round(glow/2)}px rgba(255,255,255,0.4))` : 'none';
              const isCharging = viewState.battery && viewState.battery.isCharging ? viewState.battery.isCharging : false;
              const pulseClass = (isCharging && lit) ? 'soc-bar-pulse' : '';
              return `<rect data-role="soc-bar-seg-${i}" x="2" y="${y}" width="${(SOC_BAR.width ?? 30) - 4}" height="${segH}" rx="3" ry="3" fill="${fill}" fill-opacity="${SOC_BAR.opacity ?? 0.55}" stroke="transparent" stroke-width="0" class="${pulseClass}" style="filter:${filter};" />`;
            }).join('')}
          </g>

          <polygon data-role="house-clickable-area" points="300,200 300,150 350,100 450,75 500,150 500,200 395,250" fill="transparent" style="cursor:pointer;" />

          <polygon data-role="grid-clickable-area" points="555,100 550,230 610,210 610,90 555,100" fill="transparent" style="cursor:pointer;" />

          <path data-role="inverter-clickable-area" d="M 400 290 L 445 270 L 485 290 L 485 315 L 445 340 L 400 320 L 400 290" fill="transparent" style="cursor:pointer;" />

          <g data-role="house-popup" style="display:none; cursor:pointer;">
            <rect x="${POPUP_POSITIONS.house.x}" y="${POPUP_POSITIONS.house.y}" width="${POPUP_POSITIONS.house.width}" height="${POPUP_POSITIONS.house.height}" rx="10" ry="10" class="alive-box" />
            <g data-role="house-popup-line-0-group" style="display:none;">
              <text data-role="house-popup-line-0" x="${getPopupLinePos(POPUP_POSITIONS.house, 0).textX}" y="${getPopupLinePos(POPUP_POSITIONS.house, 0).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="house-popup-toggle-0" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.house, 0).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.house, 0).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="house-popup-line-1-group" style="display:none;">
              <text data-role="house-popup-line-1" x="${getPopupLinePos(POPUP_POSITIONS.house, 1).textX}" y="${getPopupLinePos(POPUP_POSITIONS.house, 1).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="house-popup-toggle-1" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.house, 1).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.house, 1).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="house-popup-line-2-group" style="display:none;">
              <text data-role="house-popup-line-2" x="${getPopupLinePos(POPUP_POSITIONS.house, 2).textX}" y="${getPopupLinePos(POPUP_POSITIONS.house, 2).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="house-popup-toggle-2" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.house, 2).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.house, 2).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="house-popup-line-3-group" style="display:none;">
              <text data-role="house-popup-line-3" x="${getPopupLinePos(POPUP_POSITIONS.house, 3).textX}" y="${getPopupLinePos(POPUP_POSITIONS.house, 3).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="house-popup-toggle-3" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.house, 3).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.house, 3).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="house-popup-line-4-group" style="display:none;">
              <text data-role="house-popup-line-4" x="${getPopupLinePos(POPUP_POSITIONS.house, 4).textX}" y="${getPopupLinePos(POPUP_POSITIONS.house, 4).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="house-popup-toggle-4" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.house, 4).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.house, 4).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="house-popup-line-5-group" style="display:none;">
              <text data-role="house-popup-line-5" x="${getPopupLinePos(POPUP_POSITIONS.house, 5).textX}" y="${getPopupLinePos(POPUP_POSITIONS.house, 5).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="house-popup-toggle-5" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.house, 5).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.house, 5).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
          </g>

          <g data-role="grid-popup" style="display:none; cursor:pointer;">
            <rect x="${POPUP_POSITIONS.grid.x}" y="${POPUP_POSITIONS.grid.y}" width="${POPUP_POSITIONS.grid.width}" height="${POPUP_POSITIONS.grid.height}" rx="10" ry="10" class="alive-box" />
            <g data-role="grid-popup-line-0-group" style="display:none;">
              <text data-role="grid-popup-line-0" x="${getPopupLinePos(POPUP_POSITIONS.grid, 0).textX}" y="${getPopupLinePos(POPUP_POSITIONS.grid, 0).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="grid-popup-toggle-0" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.grid, 0).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.grid, 0).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="grid-popup-line-1-group" style="display:none;">
              <text data-role="grid-popup-line-1" x="${getPopupLinePos(POPUP_POSITIONS.grid, 1).textX}" y="${getPopupLinePos(POPUP_POSITIONS.grid, 1).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="grid-popup-toggle-1" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.grid, 1).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.grid, 1).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="grid-popup-line-2-group" style="display:none;">
              <text data-role="grid-popup-line-2" x="${getPopupLinePos(POPUP_POSITIONS.grid, 2).textX}" y="${getPopupLinePos(POPUP_POSITIONS.grid, 2).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="grid-popup-toggle-2" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.grid, 2).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.grid, 2).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="grid-popup-line-3-group" style="display:none;">
              <text data-role="grid-popup-line-3" x="${getPopupLinePos(POPUP_POSITIONS.grid, 3).textX}" y="${getPopupLinePos(POPUP_POSITIONS.grid, 3).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="grid-popup-toggle-3" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.grid, 3).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.grid, 3).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="grid-popup-line-4-group" style="display:none;">
              <text data-role="grid-popup-line-4" x="${getPopupLinePos(POPUP_POSITIONS.grid, 4).textX}" y="${getPopupLinePos(POPUP_POSITIONS.grid, 4).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="grid-popup-toggle-4" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.grid, 4).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.grid, 4).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="grid-popup-line-5-group" style="display:none;">
              <text data-role="grid-popup-line-5" x="${getPopupLinePos(POPUP_POSITIONS.grid, 5).textX}" y="${getPopupLinePos(POPUP_POSITIONS.grid, 5).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="grid-popup-toggle-5" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.grid, 5).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.grid, 5).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
          </g>

          <g data-role="inverter-popup" style="display:none; cursor:pointer;">
            <rect x="${POPUP_POSITIONS.inverter.x}" y="${POPUP_POSITIONS.inverter.y}" width="${POPUP_POSITIONS.inverter.width}" height="${POPUP_POSITIONS.inverter.height}" rx="10" ry="10" class="alive-box" />
            <g data-role="inverter-popup-line-0-group" style="display:none;">
              <text data-role="inverter-popup-line-0" x="${getPopupLinePos(POPUP_POSITIONS.inverter, 0).textX}" y="${getPopupLinePos(POPUP_POSITIONS.inverter, 0).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="inverter-popup-toggle-0" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.inverter, 0).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.inverter, 0).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="inverter-popup-line-1-group" style="display:none;">
              <text data-role="inverter-popup-line-1" x="${getPopupLinePos(POPUP_POSITIONS.inverter, 1).textX}" y="${getPopupLinePos(POPUP_POSITIONS.inverter, 1).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="inverter-popup-toggle-1" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.inverter, 1).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.inverter, 1).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="inverter-popup-line-2-group" style="display:none;">
              <text data-role="inverter-popup-line-2" x="${getPopupLinePos(POPUP_POSITIONS.inverter, 2).textX}" y="${getPopupLinePos(POPUP_POSITIONS.inverter, 2).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="inverter-popup-toggle-2" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.inverter, 2).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.inverter, 2).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="inverter-popup-line-3-group" style="display:none;">
              <text data-role="inverter-popup-line-3" x="${getPopupLinePos(POPUP_POSITIONS.inverter, 3).textX}" y="${getPopupLinePos(POPUP_POSITIONS.inverter, 3).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="inverter-popup-toggle-3" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.inverter, 3).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.inverter, 3).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="inverter-popup-line-4-group" style="display:none;">
              <text data-role="inverter-popup-line-4" x="${getPopupLinePos(POPUP_POSITIONS.inverter, 4).textX}" y="${getPopupLinePos(POPUP_POSITIONS.inverter, 4).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="inverter-popup-toggle-4" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.inverter, 4).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.inverter, 4).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
            <g data-role="inverter-popup-line-5-group" style="display:none;">
              <text data-role="inverter-popup-line-5" x="${getPopupLinePos(POPUP_POSITIONS.inverter, 5).textX}" y="${getPopupLinePos(POPUP_POSITIONS.inverter, 5).textY}" fill="#FFFFFF" font-size="16" font-family="sans-serif" text-anchor="middle"></text>
              <g data-role="inverter-popup-toggle-5" style="cursor:pointer; display:none;" transform="translate(${getPopupLinePos(POPUP_POSITIONS.inverter, 5).toggleX}, ${getPopupLinePos(POPUP_POSITIONS.inverter, 5).textY})">
                <rect x="-20" y="-8" width="40" height="16" rx="8" ry="8" fill="#444" stroke="#666" stroke-width="1" />
                <circle cx="-10" cy="0" r="6" fill="#fff" />
              </g>
            </g>
          </g>

          ${viewState.overlayImages.map((overlay, index) =>
            `<image data-role="overlay-image-${index + 1}" href="${overlay.image || ''}" xlink:href="${overlay.image || ''}" x="${overlay.x}" y="${overlay.y}" width="${overlay.width}" height="${overlay.height}" style="opacity:${overlay.opacity}; display:${overlay.enabled && overlay.image ? 'inline' : 'none'}; pointer-events:none;" preserveAspectRatio="none" />`
          ).join('')}
          <polygon data-role="pv-clickable-area" points="75,205 200,195 275,245 145,275 75,205" fill="transparent" style="cursor:${pvClickableCursor}; display:${pvClickableDisplay}; pointer-events: all;" />

        </svg>
        <div class="debug-coordinates" data-role="debug-coordinates">X: ---, Y: ---</div>
        ${luminaButtonsRow}
      </ha-card>
    `;
  }

  _cacheDomReferences() {
    if (!this.shadowRoot) {
      return;
    }
    const root = this.shadowRoot;
    if (this._flowPathLengths) {
      this._flowPathLengths.clear();
    }
    this._domRefs = {
      svgRoot: root.querySelector('svg'),
      background: root.querySelector('[data-role="background-image"]'),
      overlayImages: Array.from({ length: 5 }, (_, i) => root.querySelector(`[data-role="overlay-image-${i + 1}"]`)),
      debugGrid: root.querySelector('[data-role="debug-grid"]'),
      debugCoords: root.querySelector('[data-role="debug-coordinates"]'),
      title: root.querySelector('[data-role="title-text"]'),
      gridBoxGroup: root.querySelector('[data-role="grid-box"]'),
      // Optimized: use for loop instead of map for better performance
      gridBoxLines: (() => {
        const lines = [];
        for (let i = 0; i < 4; i++) {
          lines[i] = root.querySelector(`[data-role="grid-box-line-${i}"]`);
        }
        return lines;
      })(),
      pvBoxGroup: root.querySelector('[data-role="pv-box"]'),
      pvBoxLines: (() => {
        const lines = [];
        for (let i = 0; i < 2; i++) {
          lines[i] = root.querySelector(`[data-role="pv-box-line-${i}"]`);
        }
        return lines;
      })(),
      socBarGroup: root.querySelector('[data-role="soc-bar"]'),
      socBarSegments: [0,1,2,3,4,5].map(i => root.querySelector(`[data-role="soc-bar-seg-${i}"]`)),
      pvLines: Array.from({ length: MAX_PV_LINES }, (_, index) => root.querySelector(`[data-role="pv-line-${index}"]`)),
      batterySoc: root.querySelector('[data-role="battery-soc"]'),
      batteryPower: root.querySelector('[data-role="battery-power"]'),
      loadText: root.querySelector('[data-role="load-power"]'),
      loadLines: Array.from({ length: 3 }, (_, index) => root.querySelector(`[data-role="load-line-${index}"]`)),
      gridText: root.querySelector('[data-role="grid-power"]'),
      heatPumpText: root.querySelector('[data-role="heat-pump-power"]'),
      car1Label: root.querySelector('[data-role="car1-label"]'),
      car1Power: root.querySelector('[data-role="car1-power"]'),
      car1Soc: root.querySelector('[data-role="car1-soc"]'),
      car2Label: root.querySelector('[data-role="car2-label"]'),
      car2Power: root.querySelector('[data-role="car2-power"]'),
      car2Soc: root.querySelector('[data-role="car2-soc"]'),
      lineaBox1: root.querySelector('[data-role="linea-box-1"]'),
      lineaBox2: root.querySelector('[data-role="linea-box-2"]'),
      pvPopup: root.querySelector('[data-role="pv-popup"]'),
      pvPopupLines: Array.from({ length: 6 }, (_, index) => root.querySelector(`[data-role="pv-popup-line-${index}"]`)),
      pvPopupLineGroups: Array.from({ length: 6 }, (_, index) => root.querySelector(`[data-role="pv-popup-line-${index}-group"]`)),
      pvPopupToggles: Array.from({ length: 6 }, (_, index) => root.querySelector(`[data-role="pv-popup-toggle-${index}"]`)),
      pvClickableArea: root.querySelector('[data-role="pv-clickable-area"]'),
      batteryPopup: root.querySelector('[data-role="battery-popup"]'),
      batteryPopupLines: Array.from({ length: 6 }, (_, index) => root.querySelector(`[data-role="battery-popup-line-${index}"]`)),
      batteryPopupLineGroups: Array.from({ length: 6 }, (_, index) => root.querySelector(`[data-role="battery-popup-line-${index}-group"]`)),
      batteryPopupToggles: Array.from({ length: 6 }, (_, index) => root.querySelector(`[data-role="battery-popup-toggle-${index}"]`)),
      housePopup: root.querySelector('[data-role="house-popup"]'),
      housePopupLines: Array.from({ length: 6 }, (_, index) => root.querySelector(`[data-role="house-popup-line-${index}"]`)),
      housePopupLineGroups: Array.from({ length: 6 }, (_, index) => root.querySelector(`[data-role="house-popup-line-${index}-group"]`)),
      housePopupToggles: Array.from({ length: 6 }, (_, index) => root.querySelector(`[data-role="house-popup-toggle-${index}"]`)),
      houseClickableArea: root.querySelector('[data-role="house-clickable-area"]'),
      batteryClickableArea: root.querySelector('[data-role="battery-clickable-area"]'),
      gridPopup: root.querySelector('[data-role="grid-popup"]'),
      gridPopupLines: Array.from({ length: 6 }, (_, index) => root.querySelector(`[data-role="grid-popup-line-${index}"]`)),
      gridPopupLineGroups: Array.from({ length: 6 }, (_, index) => root.querySelector(`[data-role="grid-popup-line-${index}-group"]`)),
      gridPopupToggles: Array.from({ length: 6 }, (_, index) => root.querySelector(`[data-role="grid-popup-toggle-${index}"]`)),
      gridClickableArea: root.querySelector('[data-role="grid-clickable-area"]'),
      inverterPopup: root.querySelector('[data-role="inverter-popup"]'),
      inverterPopupLines: Array.from({ length: 6 }, (_, index) => root.querySelector(`[data-role="inverter-popup-line-${index}"]`)),
      inverterPopupLineGroups: Array.from({ length: 6 }, (_, index) => root.querySelector(`[data-role="inverter-popup-line-${index}-group"]`)),
      inverterPopupToggles: Array.from({ length: 6 }, (_, index) => root.querySelector(`[data-role="inverter-popup-toggle-${index}"]`)),
      inverterClickableArea: root.querySelector('[data-role="inverter-clickable-area"]'),
      echoAliveContainer: root.querySelector('[data-role="echo-alive-container"]'),
      activeTextButton: root.querySelector('[data-role="active-text-button-container"]'),
      homeButton: root.querySelector('[data-role="home-button-container"]'),
      homeCollapsiblePanel: root.querySelector('[data-role="home-collapsible-panel"]'),
      customTexts: Array.from({ length: 5 }, (_, i) => root.querySelector(`[data-role="custom-text-${i + 1}"]`)),

      flows: {
        pv1: root.querySelector('[data-flow-key="pv1"]'),
        pv2: root.querySelector('[data-flow-key="pv2"]'),
        bat: root.querySelector('[data-flow-key="bat"]'),
        load: root.querySelector('[data-flow-key="load"]'),
        grid: root.querySelector('[data-flow-key="grid"]'),
        grid_house: root.querySelector('[data-flow-key="grid_house"]'),
        car1: root.querySelector('[data-flow-key="car1"]'),
        car2: root.querySelector('[data-flow-key="car2"]'),
        heatPump: root.querySelector('[data-flow-key="heatPump"]')
      },
      arrows: {
        pv1: root.querySelector('[data-arrow-key="pv1"]'),
        pv2: root.querySelector('[data-arrow-key="pv2"]'),
        bat: root.querySelector('[data-arrow-key="bat"]'),
        load: root.querySelector('[data-arrow-key="load"]'),
        grid: root.querySelector('[data-arrow-key="grid"]'),
        grid_house: root.querySelector('[data-arrow-key="grid_house"]'),
        car1: root.querySelector('[data-arrow-key="car1"]'),
        car2: root.querySelector('[data-arrow-key="car2"]'),
        heatPump: root.querySelector('[data-arrow-key="heatPump"]')
      },
      arrowShapes: {
        pv1: Array.from(root.querySelectorAll('[data-arrow-shape="pv1"]')),
        pv2: Array.from(root.querySelectorAll('[data-arrow-shape="pv2"]')),
        bat: Array.from(root.querySelectorAll('[data-arrow-shape="bat"]')),
        load: Array.from(root.querySelectorAll('[data-arrow-shape="load"]')),
        grid: Array.from(root.querySelectorAll('[data-arrow-shape="grid"]')),
        grid_house: Array.from(root.querySelectorAll('[data-arrow-shape="grid_house"]')),
        car1: Array.from(root.querySelectorAll('[data-arrow-shape="car1"]')),
        car2: Array.from(root.querySelectorAll('[data-arrow-shape="car2"]')),
        heatPump: Array.from(root.querySelectorAll('[data-arrow-shape="heatPump"]'))
      }
    };

    // Dynamic caching for custom flows
    for (let i = 1; i <= 5; i++) {
      const flowKey = `custom_flow_${i}`;
      const flowEl = root.querySelector(`.flow-path[data-flow-key="${flowKey}"]`);
      const arrowEl = root.querySelector(`.arrow-group[data-arrow-key="${flowKey}"]`);
      const arrowShapeEls = Array.from(root.querySelectorAll(`[data-arrow-shape="${flowKey}"]`));
      
      if (flowEl) this._domRefs.flows[flowKey] = flowEl;
      if (arrowEl) this._domRefs.arrows[flowKey] = arrowEl;
      if (arrowShapeEls.length > 0) this._domRefs.arrowShapes[flowKey] = arrowShapeEls;
      
      // Fallback for arrow group if standard data-arrow-key fails
      if (!arrowEl && flowEl) {
        const parent = flowEl.parentNode;
        if (parent) {
          const fallbackArrow = parent.querySelector(`.flow-arrow[data-arrow-key="${flowKey}"]`) || 
                               parent.querySelector(`.flow-arrow`);
          if (fallbackArrow) this._domRefs.arrows[flowKey] = fallbackArrow;
        }
      }
    }

    // Cache flow path lengths asynchronously to avoid blocking the initial render
    // Optimized: use for...of loop instead of forEach for better performance
    if (this._domRefs && this._domRefs.flows) {
      requestAnimationFrame(() => {
        if (!this._domRefs || !this._domRefs.flows) return;
        const flows = this._domRefs.flows;
        for (const [key, path] of Object.entries(flows)) {
          if (path && typeof path.getTotalLength === 'function') {
            try {
              this._flowPathLengths.set(key, path.getTotalLength());
            } catch (err) {
              // skip path
            }
          }
        }
      });
    }
  }

  _togglePvPopup() {
    if (!this._domRefs || !this._domRefs.pvPopup) {
      return;
    }
    if (this._pvUiEnabled === false) {
      return;
    }
    
    const config = this._config || this.config || {};
    const hasPopupEntities = !!(config.sensor_popup_pv_1 || config.sensor_popup_pv_2 || config.sensor_popup_pv_3 || config.sensor_popup_pv_4 || config.sensor_popup_pv_5 || config.sensor_popup_pv_6);
    const hasFallback = !!(config.sensor_pv_total || config.sensor_pv1 || config.sensor_pv2 || config.sensor_pv3 || config.sensor_pv4 || config.sensor_pv5 || config.sensor_pv6 || config.sensor_pv_total_secondary || config.sensor_pv_array2_1 || config.sensor_pv_array2_2 || config.sensor_pv_array2_3 || config.sensor_pv_array2_4 || config.sensor_pv_array2_5 || config.sensor_pv_array2_6);
    const hasContent = hasPopupEntities || hasFallback;
    if (!hasContent) {
      return;
    }
    
    const popup = this._domRefs.pvPopup;
    const isVisible = popup.style.display !== 'none';
    if (isVisible) {
      this._hidePvPopup();
    } else {
      // Set flag to prevent outside click handler from closing popup immediately
      this._clickingClickableArea = true;
      setTimeout(() => {
        this._clickingClickableArea = false;
      }, 200);
      this._closeOtherPopups('pv');
      // Use setTimeout to prevent immediate click propagation
      setTimeout(() => {
        this._showPvPopup();
      }, 10);
    }
  }

  async _showPvPopup() {
    if (!this._domRefs || !this._domRefs.pvPopup) {
      return;
    }
    const popup = this._domRefs.pvPopup;
    
    // Calculate popup content
    const config = this._config || this.config || {};
    const hasPopupEntities = !!(config.sensor_popup_pv_1 || config.sensor_popup_pv_2 || config.sensor_popup_pv_3 || config.sensor_popup_pv_4 || config.sensor_popup_pv_5 || config.sensor_popup_pv_6);
    let popupPvSensorIds;
    let popupPvNames;
    if (hasPopupEntities) {
      popupPvSensorIds = [config.sensor_popup_pv_1, config.sensor_popup_pv_2, config.sensor_popup_pv_3, config.sensor_popup_pv_4, config.sensor_popup_pv_5, config.sensor_popup_pv_6];
      // Optimized: use loop instead of array literal to reduce code duplication
      popupPvNames = [];
      const nameConfigs = [
        config.sensor_popup_pv_1_name, config.sensor_popup_pv_2_name, config.sensor_popup_pv_3_name,
        config.sensor_popup_pv_4_name, config.sensor_popup_pv_5_name, config.sensor_popup_pv_6_name
      ];
      for (let i = 0; i < 6; i++) {
        const nameConfig = nameConfigs[i];
        const trimmedName = (nameConfig && typeof nameConfig === 'string') ? nameConfig.trim() : '';
        popupPvNames[i] = trimmedName || this.getEntityName(popupPvSensorIds[i]);
      }
    } else {
      // Optimized: combine filter+slice+map into single loop
      const fallbackIdsRaw = [
        config.sensor_pv_total, config.sensor_pv1, config.sensor_pv2, config.sensor_pv3, config.sensor_pv4, config.sensor_pv5, config.sensor_pv6,
        config.sensor_pv_total_secondary, config.sensor_pv_array2_1, config.sensor_pv_array2_2, config.sensor_pv_array2_3, config.sensor_pv_array2_4, config.sensor_pv_array2_5, config.sensor_pv_array2_6
      ];
      popupPvSensorIds = [];
      popupPvNames = [];
      for (let i = 0; i < fallbackIdsRaw.length && popupPvSensorIds.length < 6; i++) {
        const id = fallbackIdsRaw[i];
        if (id && typeof id === 'string') {
          const trimmed = id.trim();
          if (trimmed) {
            popupPvSensorIds.push(trimmed);
            popupPvNames.push(this.getEntityName(trimmed));
          }
        }
      }
    }
    // Optimized: combine map operations into single loop
    const popupPvValues = [];
    const lines = [];
    for (let i = 0; i < popupPvSensorIds.length; i++) {
      const sensorId = popupPvSensorIds[i];
      const valueText = this.formatPopupValue(null, sensorId);
      popupPvValues[i] = valueText;
      if (valueText) {
        lines.push(`${popupPvNames[i]}: ${valueText}`);
      }
    }
    if (!lines.length) {
      return;
    }
    
    // Calculate popup dimensions based on content
    // Find the maximum font size used in the popup for width and height calculation
    const maxFontSize = Math.max(...lines.map((_, index) => {
      const fontSizeKey = `sensor_popup_pv_${index + 1}_font_size`;
      return config[fontSizeKey] || 16;
    }));
    
    // Calculate line height based on font size (font-size + 1px padding for readability)
    const lineHeight = maxFontSize + 1;
    
    // Measure actual text width for accurate sizing
    let maxTextWidth = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${maxFontSize}px Arial, sans-serif`;
    
    lines.forEach((line) => {
      const textWidth = ctx.measureText(line).width;
      maxTextWidth = Math.max(maxTextWidth, textWidth);
    });
    
    // Check if toggles are present to adjust width calculation
    const hasToggles = popupPvSensorIds.some(id => {
      if (!id || typeof id !== 'string' || !id.trim()) return false;
      return this._isEntityControllable(id.trim());
    });
    
    // Calculate space needed for toggle: toggle width (40px) + margin (15px) + spacing from text (15px) = 70px
    const toggleSpace = hasToggles ? 70 : 0;
    
    const contentWidth = Math.max(200, Math.min(500, maxTextWidth));
    const calculatedPopupWidth = contentWidth + 40 + toggleSpace; // 40px padding + space for toggle if present
    
    // Calculate height based on content: top padding + lines + bottom padding
    const topPadding = 20;
    const bottomPadding = 20;
    const contentHeight = lines.length * lineHeight;
    const calculatedPopupHeight = topPadding + contentHeight + bottomPadding;
    
    // Use positions from config if available, otherwise center (PV popup)
    const popupX = Number(config.dev_popup_pv_x) || (800 - calculatedPopupWidth) / 2;
    const popupY = Number(config.dev_popup_pv_y) || (450 - calculatedPopupHeight) / 2;
    const popupWidth = Number(config.dev_popup_pv_width) || calculatedPopupWidth;
    const popupHeight = Number(config.dev_popup_pv_height) || calculatedPopupHeight;
    
    // Update popup rectangle
    const rect = popup.querySelector('rect');
    if (rect) {
      rect.setAttribute('x', popupX);
      rect.setAttribute('y', popupY);
      rect.setAttribute('width', popupWidth);
      rect.setAttribute('height', popupHeight);
      // Ensure popup background is semi-transparent and shows thin glowing border (hologram effect)
      rect.setAttribute('fill', '#001428');
      rect.setAttribute('fill-opacity', '0.8');
      rect.setAttribute('stroke', '#00FFFF');
      rect.setAttribute('stroke-width', '0.5');
    }
    
    // Update text positions and styling with toggles
    const lineElements = this._domRefs.pvPopupLines || [];
    const lineGroups = this._domRefs.pvPopupLineGroups || [];
    const toggleElements = this._domRefs.pvPopupToggles || [];
    
    // Use already calculated popupWidth which includes toggle space
    const adjustedPopupWidth = popupWidth;
    if (rect) {
      rect.setAttribute('width', adjustedPopupWidth);
    }
    
    // Phase A Optimization: Batch DOM updates for popup lines (reduces reflows)
    const domUpdates = [];
    lines.forEach((line, index) => {
      const element = lineElements[index];
      const group = lineGroups[index];
      const toggle = toggleElements[index];
      const sensorId = popupPvSensorIds[index];
      
      if (element && group) {
        const yPos = popupY + topPadding + (index * lineHeight) + (lineHeight / 2);
        // Adjust text position if toggle is present: move text left to make room for toggle
        const isControllable = sensorId && typeof sensorId === 'string' && sensorId.trim() && this._isEntityControllable(sensorId.trim());
        const textOffset = isControllable ? -35 : 0; // Move text left by 35px if toggle is present
        
        // Batch DOM updates
        domUpdates.push(() => {
          element.setAttribute('x', popupX + adjustedPopupWidth / 2 + textOffset);
          element.setAttribute('y', yPos);
          element.textContent = line;
          element.style.display = 'inline';
          
          // Apply font size
          const fontSizeKey = `sensor_popup_pv_${index + 1}_font_size`;
          const fontSize = config[fontSizeKey] || 16;
          element.setAttribute('font-size', fontSize);
          
          // Apply color
          const colorKey = `sensor_popup_pv_${index + 1}_color`;
          const color = config[colorKey] || '#80ffff';
          element.setAttribute('fill', color);
          
          // Show group
          group.style.display = 'inline';
          
          // Check if entity is controllable and show toggle (reuse isControllable from above)
          if (isControllable && toggle) {
            const trimmedSensorId = sensorId.trim();
            // Position toggle: popupX + popupWidth - toggleWidth - 15px margin from right edge
            // Adjust vertical alignment: raise toggle by 2px to better align with text
            const toggleWidth = 40; // Width of toggle switch
            const toggleX = popupX + adjustedPopupWidth - toggleWidth - 15;
            const toggleY = yPos - 6; // Raise toggle by 6px for better alignment
            toggle.setAttribute('transform', `translate(${toggleX}, ${toggleY})`);
            toggle.style.display = 'inline';
            
            // Set toggle to semi-transparent with cyan border
            const bgRect = toggle.querySelector('rect');
            if (bgRect) {
              bgRect.setAttribute('stroke', '#00FFFF');
              bgRect.setAttribute('stroke-width', '1.5');
              bgRect.setAttribute('opacity', '0.7');
              bgRect.style.stroke = '#00FFFF';
              bgRect.style.opacity = '0.7';
              bgRect.style.pointerEvents = 'auto';
            }
            const sliderCircle = toggle.querySelector('circle');
            if (sliderCircle) {
              sliderCircle.setAttribute('opacity', '0.9');
              sliderCircle.style.opacity = '0.9';
              sliderCircle.style.pointerEvents = 'auto';
            }
            
            // Update toggle state (on/off) using helper function
            this._updateToggleSwitch(toggle, trimmedSensorId);
            toggle.setAttribute('data-entity-id', trimmedSensorId);
            // Ensure toggle is clickable
            toggle.style.pointerEvents = 'auto';
            toggle.style.cursor = 'pointer';
          } else if (toggle) {
            toggle.style.display = 'none';
          }
        });
      }
    });
    
    // Execute all DOM updates in a single batch (1 reflow instead of N)
    if (domUpdates.length > 0) {
      requestAnimationFrame(() => {
        for (let i = 0; i < domUpdates.length; i++) {
          domUpdates[i]();
        }
        // After DOM updates, ensure all visible toggles are clickable
        (this._domRefs.pvPopupToggles || []).forEach(toggle => {
          if (toggle && toggle.style.display !== 'none') {
            toggle.style.pointerEvents = 'auto';
            toggle.style.cursor = 'pointer';
            // Ensure child elements are also clickable
            const rect = toggle.querySelector('rect');
            const circle = toggle.querySelector('circle');
            if (rect) rect.style.pointerEvents = 'auto';
            if (circle) circle.style.pointerEvents = 'auto';
          }
        });
      });
    }
    
    // Hide unused lines
    for (let i = lines.length; i < lineElements.length; i++) {
      const element = lineElements[i];
      const group = lineGroups[i];
      const toggle = toggleElements[i];
      if (element) {
        element.style.display = 'none';
      }
      if (group) {
        group.style.display = 'none';
      }
      if (toggle) {
        toggle.style.display = 'none';
      }
    }
    
    if (this._domRefs.pvClickableArea) {
      this._domRefs.pvClickableArea.style.pointerEvents = 'none';
    }
    popup.style.display = 'inline';
    popup.style.opacity = '1';
    popup.style.transform = 'scale(1)';
    popup.style.pointerEvents = 'auto';
    // Ensure popup has data-role attribute for outside click detection
    if (!popup.hasAttribute('data-role') || popup.getAttribute('data-role') !== 'pv-popup') {
      popup.setAttribute('data-role', 'pv-popup');
    }
    // Prevent clicks on popup content from closing the popup
    (this._domRefs.pvPopupLineGroups || []).forEach((group) => {
      if (group) {
        group.style.pointerEvents = 'auto';
      }
    });
    // Ensure all toggle elements are clickable
    (this._domRefs.pvPopupToggles || []).forEach((toggle) => {
      if (toggle && toggle.style.display !== 'none') {
        toggle.style.pointerEvents = 'auto';
        toggle.style.cursor = 'pointer';
        // Ensure child elements are also clickable
        const rect = toggle.querySelector('rect');
        const circle = toggle.querySelector('circle');
        if (rect) {
          rect.style.pointerEvents = 'auto';
        }
        if (circle) {
          circle.style.pointerEvents = 'auto';
        }
      }
    });
    this._activePopup = 'pv';
    // Set a flag to prevent immediate closing after opening
    this._popupJustOpened = true;
    setTimeout(() => {
      this._popupJustOpened = false;
    }, 300);
    const gsap = await this._ensureGsap();
    if (gsap) {
      gsap.fromTo(popup, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.7)' });
    }
  }

  async _hidePvPopup() {
    if (!this._domRefs || !this._domRefs.pvPopup) {
      return;
    }
    const popup = this._domRefs.pvPopup;
    const gsap = await this._ensureGsap();
    if (gsap) {
      gsap.to(popup, { opacity: 0, scale: 0.8, duration: 0.2, ease: 'power2.in', onComplete: () => {
        popup.style.display = 'none';
        if (this._activePopup === 'pv') this._activePopup = null;
        if (this._domRefs.pvClickableArea) {
          this._domRefs.pvClickableArea.style.pointerEvents = 'all';
        }
      }});
    } else {
      popup.style.display = 'none';
      if (this._activePopup === 'pv') this._activePopup = null;
      if (this._domRefs.pvClickableArea) {
        this._domRefs.pvClickableArea.style.pointerEvents = 'all';
      }
    }
  }

  _toggleBatteryPopup() {
    if (!this._domRefs || !this._domRefs.batteryPopup) return;

    const config = this._config || this.config || {};
    const hasContent = config.sensor_popup_bat_1 || config.sensor_popup_bat_2 ||
                      config.sensor_popup_bat_3 || config.sensor_popup_bat_4 ||
                      config.sensor_popup_bat_5 || config.sensor_popup_bat_6;
    if (!hasContent) return;

    const popup = this._domRefs.batteryPopup;
    const isVisible = popup.style.display !== 'none';
    if (isVisible) {
      this._hideBatteryPopup();
    } else {
      this._closeOtherPopups('battery');
      // Use setTimeout to prevent immediate click propagation
      setTimeout(() => {
        this._showBatteryPopup();
      }, 10);
    }
  }

  async _showBatteryPopup() {
    if (!this._domRefs || !this._domRefs.batteryPopup) {
      return;
    }
    const popup = this._domRefs.batteryPopup;
    const config = this._config || this.config || {};
    const popupBatSensorIds = [
      config.sensor_popup_bat_1,
      config.sensor_popup_bat_2,
      config.sensor_popup_bat_3,
      config.sensor_popup_bat_4,
      config.sensor_popup_bat_5,
      config.sensor_popup_bat_6
    ];
    const popupBatValues = popupBatSensorIds.map((sensorId) => this.formatPopupValue(null, sensorId));

    const popupBatNames = [
      config.sensor_popup_bat_1_name && config.sensor_popup_bat_1_name.trim() ? config.sensor_popup_bat_1_name.trim() : this.getEntityName(config.sensor_popup_bat_1),
      config.sensor_popup_bat_2_name && config.sensor_popup_bat_2_name.trim() ? config.sensor_popup_bat_2_name.trim() : this.getEntityName(config.sensor_popup_bat_2),
      config.sensor_popup_bat_3_name && config.sensor_popup_bat_3_name.trim() ? config.sensor_popup_bat_3_name.trim() : this.getEntityName(config.sensor_popup_bat_3),
      config.sensor_popup_bat_4_name && config.sensor_popup_bat_4_name.trim() ? config.sensor_popup_bat_4_name.trim() : this.getEntityName(config.sensor_popup_bat_4),
      config.sensor_popup_bat_5_name && config.sensor_popup_bat_5_name.trim() ? config.sensor_popup_bat_5_name.trim() : this.getEntityName(config.sensor_popup_bat_5),
      config.sensor_popup_bat_6_name && config.sensor_popup_bat_6_name.trim() ? config.sensor_popup_bat_6_name.trim() : this.getEntityName(config.sensor_popup_bat_6)
    ];

    const lines = popupBatValues
      .map((valueText, i) => (valueText ? `${popupBatNames[i]}: ${valueText}` : ''))
      .filter((line) => line);
    if (!lines.length) return;

    // Calculate popup dimensions based on content
    // Find the maximum font size used in the popup for width and height calculation
    const maxFontSize = Math.max(...lines.map((_, index) => {
      const fontSizeKey = `sensor_popup_bat_${index + 1}_font_size`;
      return config[fontSizeKey] || 16;
    }));
    
    // Calculate line height based on font size (font-size + 1px padding for readability)
    const lineHeight = maxFontSize + 1;
    
    // Measure actual text width for accurate sizing
    let maxTextWidth = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${maxFontSize}px Arial, sans-serif`;
    
    lines.forEach((line) => {
      const textWidth = ctx.measureText(line).width;
      maxTextWidth = Math.max(maxTextWidth, textWidth);
    });
    
    // Check if toggles are present to adjust width calculation
    const hasToggles = popupBatSensorIds.some(id => {
      if (!id || typeof id !== 'string' || !id.trim()) return false;
      return this._isEntityControllable(id.trim());
    });
    
    // Calculate space needed for toggle: toggle width (40px) + margin (15px) + spacing from text (15px) = 70px
    const toggleSpace = hasToggles ? 70 : 0;
    
    const contentWidth = Math.max(200, Math.min(500, maxTextWidth));
    const calculatedPopupWidth = contentWidth + 40 + toggleSpace; // 40px padding + space for toggle if present
    
    // Calculate height based on content: top padding + lines + bottom padding
    const topPadding = 20;
    const bottomPadding = 20;
    const contentHeight = lines.length * lineHeight;
    const calculatedPopupHeight = topPadding + contentHeight + bottomPadding;
    
    // Use positions from config if available, otherwise center (Battery popup)
    const popupX = Number(config.dev_popup_battery_x) || (800 - calculatedPopupWidth) / 2;
    const popupY = Number(config.dev_popup_battery_y) || (450 - calculatedPopupHeight) / 2;
    const popupWidth = Number(config.dev_popup_battery_width) || calculatedPopupWidth;
    const popupHeight = Number(config.dev_popup_battery_height) || calculatedPopupHeight;

    const batRect = popup.querySelector('rect');
    if (batRect) {
      batRect.setAttribute('x', popupX);
      batRect.setAttribute('y', popupY);
      batRect.setAttribute('width', popupWidth);
      batRect.setAttribute('height', popupHeight);
      // Ensure popup background is semi-transparent and shows thin glowing border (hologram effect)
      batRect.setAttribute('fill', '#001428');
      batRect.setAttribute('fill-opacity', '0.8');
      batRect.setAttribute('stroke', '#00FFFF');
      batRect.setAttribute('stroke-width', '0.5');
    }

    // Update text positions and styling with toggles
    const lineElements = this._domRefs.batteryPopupLines || [];
    const lineGroups = this._domRefs.batteryPopupLineGroups || [];
    const toggleElements = this._domRefs.batteryPopupToggles || [];
    
    // Use already calculated popupWidth which includes toggle space
    const adjustedPopupWidth = popupWidth;
    
    lines.forEach((line, index) => {
      const element = lineElements[index];
      const group = lineGroups[index];
      const toggle = toggleElements[index];
      const sensorId = popupBatSensorIds[index];
      
      if (element && group) {
        const yPos = popupY + topPadding + (index * lineHeight) + (lineHeight / 2);
        // Adjust text position if toggle is present: move text left to make room for toggle
        const isControllable = sensorId && typeof sensorId === 'string' && sensorId.trim() && this._isEntityControllable(sensorId.trim());
        const textOffset = isControllable ? -35 : 0; // Move text left by 35px if toggle is present
        element.setAttribute('x', popupX + adjustedPopupWidth / 2 + textOffset);
        element.setAttribute('y', yPos);
        element.textContent = line;
        element.style.display = 'inline';
        
        // Apply font size
        const fontSizeKey = `sensor_popup_bat_${index + 1}_font_size`;
        const fontSize = config[fontSizeKey] || 16;
        element.setAttribute('font-size', fontSize);
        
        // Apply color
        const colorKey = `sensor_popup_bat_${index + 1}_color`;
        const color = config[colorKey] || '#80ffff';
        element.setAttribute('fill', color);
        
        // Show group
        group.style.display = 'inline';
        
        // Check if entity is controllable and show toggle (reuse isControllable from above)
        if (isControllable && toggle) {
          const trimmedSensorId = sensorId.trim();
          // Position toggle: popupX + popupWidth - toggleWidth - 15px margin from right edge
          // Adjust vertical alignment: raise toggle by 2px to better align with text
          const toggleWidth = 40; // Width of toggle switch
          const toggleX = popupX + adjustedPopupWidth - toggleWidth - 15;
          const toggleY = yPos - 6; // Raise toggle by 6px for better alignment
          toggle.setAttribute('transform', `translate(${toggleX}, ${toggleY})`);
          toggle.style.display = 'inline';
          
          // Set toggle to semi-transparent with cyan border
          const bgRect = toggle.querySelector('rect');
          if (bgRect) {
            bgRect.setAttribute('stroke', '#00FFFF');
            bgRect.setAttribute('stroke-width', '1.5');
            bgRect.setAttribute('opacity', '0.7');
            bgRect.style.stroke = '#00FFFF';
            bgRect.style.opacity = '0.7';
          }
          const sliderCircle = toggle.querySelector('circle');
          if (sliderCircle) {
            sliderCircle.setAttribute('opacity', '0.9');
            sliderCircle.style.opacity = '0.9';
          }
          
          // Update toggle state (on/off) using helper function
          this._updateToggleSwitch(toggle, trimmedSensorId);
          toggle.setAttribute('data-entity-id', trimmedSensorId);
        } else if (toggle) {
          toggle.style.display = 'none';
        }
      }
    });

    // Hide unused lines
    for (let i = lines.length; i < lineElements.length; i++) {
      const element = lineElements[i];
      const group = lineGroups[i];
      const toggle = toggleElements[i];
      if (element) {
        element.style.display = 'none';
      }
      if (group) {
        group.style.display = 'none';
      }
      if (toggle) {
        toggle.style.display = 'none';
      }
    }

    popup.style.display = 'inline';
    popup.style.opacity = '1';
    popup.style.transform = 'scale(1)';
    popup.style.pointerEvents = 'auto';
    // Prevent clicks on popup content from closing the popup
    (this._domRefs.batteryPopupLineGroups || []).forEach(group => {
      if (group) {
        group.style.pointerEvents = 'auto';
      }
    });
    this._activePopup = 'battery';
    // Set a flag to prevent immediate closing after opening
    this._popupJustOpened = true;
    setTimeout(() => {
      this._popupJustOpened = false;
    }, 300);
    const gsap = await this._ensureGsap();
    if (gsap) {
      gsap.fromTo(popup, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.7)' });
    }
  }

  async _hideBatteryPopup() {
    if (!this._domRefs || !this._domRefs.batteryPopup) {
      return;
    }
    const popup = this._domRefs.batteryPopup;
    const gsap = await this._ensureGsap();
    if (gsap) {
      gsap.to(popup, { opacity: 0, scale: 0.8, duration: 0.2, ease: 'power2.in', onComplete: () => {
        popup.style.display = 'none';
        if (this._activePopup === 'battery') this._activePopup = null;
      }});
    } else {
      popup.style.display = 'none';
      if (this._activePopup === 'battery') this._activePopup = null;
    }
  }

  _toggleHousePopup() {
    if (!this._domRefs || !this._domRefs.housePopup) {
      return;
    }
    
    // Check if popup has any content by checking if any house entities are configured
    const config = this._config || this.config || {};
    if (!config) return;
    const hasContent = (config.sensor_popup_house_1 && config.sensor_popup_house_1.trim()) || 
                      (config.sensor_popup_house_2 && config.sensor_popup_house_2.trim()) || 
                      (config.sensor_popup_house_3 && config.sensor_popup_house_3.trim()) || 
                      (config.sensor_popup_house_4 && config.sensor_popup_house_4.trim()) || 
                      (config.sensor_popup_house_5 && config.sensor_popup_house_5.trim()) || 
                      (config.sensor_popup_house_6 && config.sensor_popup_house_6.trim());
    if (!hasContent) {
      return;
    }
    
    const popup = this._domRefs.housePopup;
    const isVisible = popup.style.display !== 'none';
    if (isVisible) {
      this._hideHousePopup();
    } else {
      this._closeOtherPopups('house');
      this._showHousePopup();
    }
  }

  async _showHousePopup() {
    if (!this._domRefs || !this._domRefs.housePopup) {
      return;
    }
    const popup = this._domRefs.housePopup;
    // Get house popup data
    const config = this._config || this.config || {};
    if (!config) return;
    const popupHouseSensorIds = [
      config.sensor_popup_house_1,
      config.sensor_popup_house_2,
      config.sensor_popup_house_3,
      config.sensor_popup_house_4,
      config.sensor_popup_house_5,
      config.sensor_popup_house_6
    ];
    // Optimized: use for loop instead of map for better performance
    const popupHouseValues = [];
    for (let i = 0; i < popupHouseSensorIds.length; i++) {
      popupHouseValues[i] = this.formatPopupValue(null, popupHouseSensorIds[i]);
    }
    
    const popupHouseNames = [
      config.sensor_popup_house_1_name && config.sensor_popup_house_1_name.trim() ? config.sensor_popup_house_1_name.trim() : this.getEntityName(config.sensor_popup_house_1),
      config.sensor_popup_house_2_name && config.sensor_popup_house_2_name.trim() ? config.sensor_popup_house_2_name.trim() : this.getEntityName(config.sensor_popup_house_2),
      config.sensor_popup_house_3_name && config.sensor_popup_house_3_name.trim() ? config.sensor_popup_house_3_name.trim() : this.getEntityName(config.sensor_popup_house_3),
      config.sensor_popup_house_4_name && config.sensor_popup_house_4_name.trim() ? config.sensor_popup_house_4_name.trim() : this.getEntityName(config.sensor_popup_house_4),
      config.sensor_popup_house_5_name && config.sensor_popup_house_5_name.trim() ? config.sensor_popup_house_5_name.trim() : this.getEntityName(config.sensor_popup_house_5),
      config.sensor_popup_house_6_name && config.sensor_popup_house_6_name.trim() ? config.sensor_popup_house_6_name.trim() : this.getEntityName(config.sensor_popup_house_6)
    ];
    
    const lines = popupHouseValues
      .map((valueText, i) => (valueText ? `${popupHouseNames[i]}: ${valueText}` : ''))
      .filter((line) => line);
    if (!lines.length) return;
    
    // Calculate popup dimensions based on content
    // Find the maximum font size used in the popup for width and height calculation
    const maxFontSize = Math.max(...lines.map((_, index) => {
      const fontSizeKey = `sensor_popup_house_${index + 1}_font_size`;
      return config[fontSizeKey] || 16;
    }));
    
    // Calculate line height based on font size (font-size + 1px padding for readability)
    const lineHeight = maxFontSize + 1;
    
    // Measure actual text width for accurate sizing
    let maxTextWidth = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${maxFontSize}px Arial, sans-serif`;
    
    lines.forEach((line) => {
      const textWidth = ctx.measureText(line).width;
      maxTextWidth = Math.max(maxTextWidth, textWidth);
    });
    
    // Check if toggles are present to adjust width calculation
    const hasTogglesHouse = popupHouseSensorIds.some(id => {
      if (!id || typeof id !== 'string' || !id.trim()) return false;
      return this._isEntityControllable(id.trim());
    });
    
    // Calculate space needed for toggle: toggle width (40px) + margin (15px) + spacing from text (15px) = 70px
    const toggleSpace = hasTogglesHouse ? 70 : 0;
    
    const contentWidth = Math.max(200, Math.min(500, maxTextWidth));
    const calculatedPopupWidth = contentWidth + 40 + toggleSpace; // 40px padding + space for toggle if present
    
    // Calculate height based on content: top padding + lines + bottom padding
    const topPadding = 20;
    const bottomPadding = 20;
    const contentHeight = lines.length * lineHeight;
    const calculatedPopupHeight = topPadding + contentHeight + bottomPadding;
    
    // Use positions from config if available, otherwise center (House popup)
    const popupX = Number(config.dev_popup_house_x) || (800 - calculatedPopupWidth) / 2;
    const popupY = Number(config.dev_popup_house_y) || (450 - calculatedPopupHeight) / 2;
    const popupWidth = Number(config.dev_popup_house_width) || calculatedPopupWidth;
    const popupHeight = Number(config.dev_popup_house_height) || calculatedPopupHeight;
    
    // Update popup rectangle
    const rect = popup.querySelector('rect');
    if (rect) {
      rect.setAttribute('x', popupX);
      rect.setAttribute('y', popupY);
      rect.setAttribute('width', popupWidth);
      rect.setAttribute('height', popupHeight);
      // Ensure popup background is semi-transparent and shows thin glowing border (hologram effect)
      rect.setAttribute('fill', '#001428');
      rect.setAttribute('fill-opacity', '0.8');
      rect.setAttribute('stroke', '#00FFFF');
      rect.setAttribute('stroke-width', '0.5');
    }
    
    // Update text positions and styling with toggles
    const lineElements = this._domRefs.housePopupLines || [];
    const lineGroups = this._domRefs.housePopupLineGroups || [];
    const toggleElements = this._domRefs.housePopupToggles || [];
    
    // Use already calculated popupWidth which includes toggle space
    const adjustedPopupWidth = popupWidth;
    if (rect) {
      rect.setAttribute('width', adjustedPopupWidth);
    }
    
    lines.forEach((line, index) => {
      const element = lineElements[index];
      const group = lineGroups[index];
      const toggle = toggleElements[index];
      const sensorId = popupHouseSensorIds[index];
      
      if (element && group && line) {
        const yPos = popupY + topPadding + (index * lineHeight) + (lineHeight / 2);
        // Adjust text position if toggle is present: move text left to make room for toggle
        const isControllable = sensorId && typeof sensorId === 'string' && sensorId.trim() && this._isEntityControllable(sensorId.trim());
        const textOffset = isControllable ? -35 : 0; // Move text left by 35px if toggle is present
        element.setAttribute('x', popupX + adjustedPopupWidth / 2 + textOffset);
        element.setAttribute('y', yPos);
        element.textContent = line;
        element.style.display = 'inline';
        
        // Apply font size
        const fontSizeKey = `sensor_popup_house_${index + 1}_font_size`;
        const fontSize = config[fontSizeKey] || 16;
        element.setAttribute('font-size', fontSize);
        
        // Apply color
        const colorKey = `sensor_popup_house_${index + 1}_color`;
        const color = config[colorKey] || '#80ffff';
        element.setAttribute('fill', color);
        
        // Show group
        group.style.display = 'inline';
        
        // Check if entity is controllable and show toggle (reuse isControllable from above)
        if (isControllable && toggle) {
          const trimmedSensorId = sensorId.trim();
          // Position toggle: popupX + popupWidth - toggleWidth - 15px margin from right edge
          // Adjust vertical alignment: raise toggle by 2px to better align with text
          const toggleWidth = 40; // Width of toggle switch
          const toggleX = popupX + adjustedPopupWidth - toggleWidth - 15;
          const toggleY = yPos - 6; // Raise toggle by 6px for better alignment
          toggle.setAttribute('transform', `translate(${toggleX}, ${toggleY})`);
          toggle.style.display = 'inline';
          
          // Set toggle to semi-transparent with cyan border
          const bgRect = toggle.querySelector('rect');
          if (bgRect) {
            bgRect.setAttribute('stroke', '#00FFFF');
            bgRect.setAttribute('stroke-width', '1.5');
            bgRect.setAttribute('opacity', '0.7');
            bgRect.style.stroke = '#00FFFF';
            bgRect.style.opacity = '0.7';
          }
          const sliderCircle = toggle.querySelector('circle');
          if (sliderCircle) {
            sliderCircle.setAttribute('opacity', '0.9');
            sliderCircle.style.opacity = '0.9';
          }
          
          // Update toggle state (on/off) using helper function
          this._updateToggleSwitch(toggle, trimmedSensorId);
          toggle.setAttribute('data-entity-id', trimmedSensorId);
        } else if (toggle) {
          toggle.style.display = 'none';
        }
      } else if (element) {
        element.style.display = 'none';
      }
    });
    
    // Hide unused lines
    for (let i = lines.length; i < lineElements.length; i++) {
      const element = lineElements[i];
      const group = lineGroups[i];
      const toggle = toggleElements[i];
      if (element) {
        element.style.display = 'none';
      }
      if (group) {
        group.style.display = 'none';
      }
      if (toggle) {
        toggle.style.display = 'none';
      }
    }
    
    popup.style.display = 'inline';
    popup.style.opacity = '1';
    popup.style.transform = 'scale(1)';
    popup.style.pointerEvents = 'auto';
    // Prevent clicks on popup content from closing the popup
    (this._domRefs.housePopupLineGroups || []).forEach(group => {
      if (group) {
        group.style.pointerEvents = 'auto';
      }
    });
    this._activePopup = 'house';
    // Set a flag to prevent immediate closing after opening
    this._popupJustOpened = true;
    setTimeout(() => {
      this._popupJustOpened = false;
    }, 300);
    const gsap = await this._ensureGsap();
    if (gsap) {
      gsap.fromTo(popup, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.7)' });
    }
  }

  async _hideHousePopup() {
    if (!this._domRefs || !this._domRefs.housePopup) {
      return;
    }
    const popup = this._domRefs.housePopup;
    const gsap = await this._ensureGsap();
    if (gsap) {
      gsap.to(popup, { opacity: 0, scale: 0.8, duration: 0.2, ease: 'power2.in', onComplete: () => {
        popup.style.display = 'none';
        if (this._activePopup === 'house') this._activePopup = null;
      }});
    } else {
      popup.style.display = 'none';
      if (this._activePopup === 'house') this._activePopup = null;
    }
  }

  _toggleGridPopup() {
    if (!this._domRefs || !this._domRefs.gridPopup) {
      return;
    }
    
    // Check if popup has any content by checking if any grid entities are configured
    const config = this._config || this.config || {};
    if (!config) return;
    const hasContent = (config.sensor_popup_grid_1 && config.sensor_popup_grid_1.trim()) || 
                      (config.sensor_popup_grid_2 && config.sensor_popup_grid_2.trim()) || 
                      (config.sensor_popup_grid_3 && config.sensor_popup_grid_3.trim()) || 
                      (config.sensor_popup_grid_4 && config.sensor_popup_grid_4.trim()) || 
                      (config.sensor_popup_grid_5 && config.sensor_popup_grid_5.trim()) || 
                      (config.sensor_popup_grid_6 && config.sensor_popup_grid_6.trim());
    if (!hasContent) {
      return;
    }
    
    const popup = this._domRefs.gridPopup;
    const isVisible = popup.style.display !== 'none';
    if (isVisible) {
      this._hideGridPopup();
    } else {
      this._closeOtherPopups('grid');
      // Use setTimeout to prevent immediate click propagation
      setTimeout(() => {
        this._showGridPopup();
      }, 10);
    }
  }

  async _showGridPopup() {
    if (!this._domRefs || !this._domRefs.gridPopup) {
      return;
    }
    const popup = this._domRefs.gridPopup;
    // Calculate popup content
    const config = this._config || this.config || {};
    
    const popupGridSensorIds = [
      config.sensor_popup_grid_1,
      config.sensor_popup_grid_2,
      config.sensor_popup_grid_3,
      config.sensor_popup_grid_4,
      config.sensor_popup_grid_5,
      config.sensor_popup_grid_6
    ];
    const popupGridValues = popupGridSensorIds.map((sensorId) => this.formatPopupValue(null, sensorId));

    const popupGridNames = [
      config.sensor_popup_grid_1_name && config.sensor_popup_grid_1_name.trim() ? config.sensor_popup_grid_1_name.trim() : this.getEntityName(config.sensor_popup_grid_1),
      config.sensor_popup_grid_2_name && config.sensor_popup_grid_2_name.trim() ? config.sensor_popup_grid_2_name.trim() : this.getEntityName(config.sensor_popup_grid_2),
      config.sensor_popup_grid_3_name && config.sensor_popup_grid_3_name.trim() ? config.sensor_popup_grid_3_name.trim() : this.getEntityName(config.sensor_popup_grid_3),
      config.sensor_popup_grid_4_name && config.sensor_popup_grid_4_name.trim() ? config.sensor_popup_grid_4_name.trim() : this.getEntityName(config.sensor_popup_grid_4),
      config.sensor_popup_grid_5_name && config.sensor_popup_grid_5_name.trim() ? config.sensor_popup_grid_5_name.trim() : this.getEntityName(config.sensor_popup_grid_5),
      config.sensor_popup_grid_6_name && config.sensor_popup_grid_6_name.trim() ? config.sensor_popup_grid_6_name.trim() : this.getEntityName(config.sensor_popup_grid_6)
    ];

    const lines = popupGridValues
      .map((valueText, i) => (valueText ? `${popupGridNames[i]}: ${valueText}` : ''))
      .filter((line) => line);
    if (!lines.length) return;
    
    // Calculate popup dimensions based on content
    // Find the maximum font size used in the popup for width and height calculation
    const maxFontSize = Math.max(...lines.map((_, index) => {
      const fontSizeKey = `sensor_popup_grid_${index + 1}_font_size`;
      return config[fontSizeKey] || 16;
    }));
    
    // Calculate line height based on font size (font-size + 1px padding for readability)
    const lineHeight = maxFontSize + 1;
    
    // Measure actual text width for accurate sizing
    let maxTextWidth = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${maxFontSize}px Arial, sans-serif`;
    
    lines.forEach((line) => {
      const textWidth = ctx.measureText(line).width;
      maxTextWidth = Math.max(maxTextWidth, textWidth);
    });
    
    // Check if toggles are present to adjust width calculation
    const hasTogglesGrid = popupGridSensorIds.some(id => {
      if (!id || typeof id !== 'string' || !id.trim()) return false;
      return this._isEntityControllable(id.trim());
    });
    
    // Calculate space needed for toggle: toggle width (40px) + margin (15px) + spacing from text (15px) = 70px
    const toggleSpace = hasTogglesGrid ? 70 : 0;
    
    const contentWidth = Math.max(200, Math.min(500, maxTextWidth));
    const calculatedPopupWidth = contentWidth + 40 + toggleSpace; // 40px padding + space for toggle if present
    
    // Calculate height based on content: top padding + lines + bottom padding
    const topPadding = 20;
    const bottomPadding = 20;
    const contentHeight = lines.length * lineHeight;
    const calculatedPopupHeight = topPadding + contentHeight + bottomPadding;
    
    // Use positions from config if available, otherwise center (Grid popup)
    const popupX = Number(config.dev_popup_grid_x) || (800 - calculatedPopupWidth) / 2;
    const popupY = Number(config.dev_popup_grid_y) || (450 - calculatedPopupHeight) / 2;
    const popupWidth = Number(config.dev_popup_grid_width) || calculatedPopupWidth;
    const popupHeight = Number(config.dev_popup_grid_height) || calculatedPopupHeight;
    
    // Update popup rectangle
    const rect = popup.querySelector('rect');
    if (rect) {
      rect.setAttribute('x', popupX);
      rect.setAttribute('y', popupY);
      rect.setAttribute('width', popupWidth);
      rect.setAttribute('height', popupHeight);
      // Ensure popup background is semi-transparent and shows thin glowing border (hologram effect)
      rect.setAttribute('fill', '#001428');
      rect.setAttribute('fill-opacity', '0.8');
      rect.setAttribute('stroke', '#00FFFF');
      rect.setAttribute('stroke-width', '0.5');
    }
    
    // Update text positions and styling with toggles
    const lineElements = this._domRefs.gridPopupLines || [];
    const lineGroups = this._domRefs.gridPopupLineGroups || [];
    const toggleElements = this._domRefs.gridPopupToggles || [];
    
    // Use already calculated popupWidth which includes toggle space
    const adjustedPopupWidth = popupWidth;
    if (rect) {
      rect.setAttribute('width', adjustedPopupWidth);
    }
    
    lines.forEach((line, index) => {
      const element = lineElements[index];
      const group = lineGroups[index];
      const toggle = toggleElements[index];
      const sensorId = popupGridSensorIds[index];
      
      if (element && group) {
        const yPos = popupY + topPadding + (index * lineHeight) + (lineHeight / 2);
        // Adjust text position if toggle is present: move text left to make room for toggle
        const isControllable = sensorId && typeof sensorId === 'string' && sensorId.trim() && this._isEntityControllable(sensorId.trim());
        const textOffset = isControllable ? -35 : 0; // Move text left by 35px if toggle is present
        element.setAttribute('x', popupX + adjustedPopupWidth / 2 + textOffset);
        element.setAttribute('y', yPos);
        element.textContent = line;
        element.style.display = 'inline';
        
        // Apply font size
        const fontSizeKey = `sensor_popup_grid_${index + 1}_font_size`;
        const fontSize = config[fontSizeKey] || 16;
        element.setAttribute('font-size', fontSize);
        
        // Apply color
        const colorKey = `sensor_popup_grid_${index + 1}_color`;
        const color = config[colorKey] || '#80ffff';
        element.setAttribute('fill', color);
        
        // Show group
        group.style.display = 'inline';
        
        // Check if entity is controllable and show toggle (reuse isControllable from above)
        if (isControllable && toggle) {
          const trimmedSensorId = sensorId.trim();
          // Position toggle: popupX + popupWidth - toggleWidth - 15px margin from right edge
          // Adjust vertical alignment: raise toggle by 2px to better align with text
          const toggleWidth = 40; // Width of toggle switch
          const toggleX = popupX + adjustedPopupWidth - toggleWidth - 15;
          const toggleY = yPos - 6; // Raise toggle by 6px for better alignment
          toggle.setAttribute('transform', `translate(${toggleX}, ${toggleY})`);
          toggle.style.display = 'inline';
          
          // Set toggle to semi-transparent with cyan border
          const bgRect = toggle.querySelector('rect');
          if (bgRect) {
            bgRect.setAttribute('stroke', '#00FFFF');
            bgRect.setAttribute('stroke-width', '1.5');
            bgRect.setAttribute('opacity', '0.7');
            bgRect.style.stroke = '#00FFFF';
            bgRect.style.opacity = '0.7';
          }
          const sliderCircle = toggle.querySelector('circle');
          if (sliderCircle) {
            sliderCircle.setAttribute('opacity', '0.9');
            sliderCircle.style.opacity = '0.9';
          }
          
          // Update toggle state (on/off) using helper function
          this._updateToggleSwitch(toggle, trimmedSensorId);
          toggle.setAttribute('data-entity-id', trimmedSensorId);
        } else if (toggle) {
          toggle.style.display = 'none';
        }
      }
    });
    
    // Hide unused lines
    for (let i = lines.length; i < lineElements.length; i++) {
      const element = lineElements[i];
      const group = lineGroups[i];
      const toggle = toggleElements[i];
      if (element) {
        element.style.display = 'none';
      }
      if (group) {
        group.style.display = 'none';
      }
      if (toggle) {
        toggle.style.display = 'none';
      }
    }
    
    popup.style.display = 'inline';
    popup.style.opacity = '1';
    popup.style.transform = 'scale(1)';
    popup.style.pointerEvents = 'auto';
    // Prevent clicks on popup content from closing the popup
    (this._domRefs.gridPopupLineGroups || []).forEach(group => {
      if (group) {
        group.style.pointerEvents = 'auto';
      }
    });
    this._activePopup = 'grid';
    // Set a flag to prevent immediate closing after opening
    this._popupJustOpened = true;
    setTimeout(() => {
      this._popupJustOpened = false;
    }, 300);
    const gsap = await this._ensureGsap();
    if (gsap) {
      gsap.fromTo(popup, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.7)' });
    }
  }

  async _hideGridPopup() {
    if (!this._domRefs || !this._domRefs.gridPopup) {
      return;
    }
    const popup = this._domRefs.gridPopup;
    const gsap = await this._ensureGsap();
    if (gsap) {
      gsap.to(popup, { opacity: 0, scale: 0.8, duration: 0.2, ease: 'power2.in', onComplete: () => {
        popup.style.display = 'none';
        if (this._activePopup === 'grid') this._activePopup = null;
      }});
    } else {
      popup.style.display = 'none';
      if (this._activePopup === 'grid') this._activePopup = null;
    }
  }

  _toggleInverterPopup() {
    if (!this._domRefs || !this._domRefs.inverterPopup) {
      return;
    }
    
    // Check if popup has any content by checking if any inverter entities are configured
    const config = this._config || this.config || {};
    if (!config) return;
    const hasContent = (config.sensor_popup_inverter_1 && config.sensor_popup_inverter_1.trim()) || 
                      (config.sensor_popup_inverter_2 && config.sensor_popup_inverter_2.trim()) || 
                      (config.sensor_popup_inverter_3 && config.sensor_popup_inverter_3.trim()) || 
                      (config.sensor_popup_inverter_4 && config.sensor_popup_inverter_4.trim()) || 
                      (config.sensor_popup_inverter_5 && config.sensor_popup_inverter_5.trim()) || 
                      (config.sensor_popup_inverter_6 && config.sensor_popup_inverter_6.trim());
    if (!hasContent) {
      return;
    }
    
    const popup = this._domRefs.inverterPopup;
    const isVisible = popup.style.display !== 'none';
    if (isVisible) {
      this._hideInverterPopup();
    } else {
      this._closeOtherPopups('inverter');
      // Use setTimeout to prevent immediate click propagation
      setTimeout(() => {
        this._showInverterPopup();
      }, 10);
    }
  }

  async _showInverterPopup() {
    if (!this._domRefs || !this._domRefs.inverterPopup) {
      return;
    }
    const popup = this._domRefs.inverterPopup;
    
    // Calculate popup content
    const config = this._config || this.config || {};
    
    const popupInverterSensorIds = [
      config.sensor_popup_inverter_1,
      config.sensor_popup_inverter_2,
      config.sensor_popup_inverter_3,
      config.sensor_popup_inverter_4,
      config.sensor_popup_inverter_5,
      config.sensor_popup_inverter_6
    ];
    const popupInverterValues = popupInverterSensorIds.map((sensorId) => this.formatPopupValue(null, sensorId));

    const popupInverterNames = [
      config.sensor_popup_inverter_1_name && config.sensor_popup_inverter_1_name.trim() ? config.sensor_popup_inverter_1_name.trim() : this.getEntityName(config.sensor_popup_inverter_1),
      config.sensor_popup_inverter_2_name && config.sensor_popup_inverter_2_name.trim() ? config.sensor_popup_inverter_2_name.trim() : this.getEntityName(config.sensor_popup_inverter_2),
      config.sensor_popup_inverter_3_name && config.sensor_popup_inverter_3_name.trim() ? config.sensor_popup_inverter_3_name.trim() : this.getEntityName(config.sensor_popup_inverter_3),
      config.sensor_popup_inverter_4_name && config.sensor_popup_inverter_4_name.trim() ? config.sensor_popup_inverter_4_name.trim() : this.getEntityName(config.sensor_popup_inverter_4),
      config.sensor_popup_inverter_5_name && config.sensor_popup_inverter_5_name.trim() ? config.sensor_popup_inverter_5_name.trim() : this.getEntityName(config.sensor_popup_inverter_5),
      config.sensor_popup_inverter_6_name && config.sensor_popup_inverter_6_name.trim() ? config.sensor_popup_inverter_6_name.trim() : this.getEntityName(config.sensor_popup_inverter_6)
    ];

    const lines = popupInverterValues
      .map((valueText, i) => (valueText ? `${popupInverterNames[i]}: ${valueText}` : ''))
      .filter((line) => line);
    if (!lines.length) return;
    
    // Calculate popup dimensions based on content
    // Find the maximum font size used in the popup for width and height calculation
    const maxFontSize = Math.max(...lines.map((_, index) => {
      const fontSizeKey = `sensor_popup_inverter_${index + 1}_font_size`;
      return config[fontSizeKey] || 16;
    }));
    
    // Calculate line height based on font size (font-size + 1px padding for readability)
    const lineHeight = maxFontSize + 1;
    
    // Measure actual text width for accurate sizing
    let maxTextWidth = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${maxFontSize}px Arial, sans-serif`;
    
    lines.forEach((line) => {
      const textWidth = ctx.measureText(line).width;
      maxTextWidth = Math.max(maxTextWidth, textWidth);
    });
    
    // Check if toggles are present to adjust width calculation
    const hasTogglesInverter = popupInverterSensorIds.some(id => {
      if (!id || typeof id !== 'string' || !id.trim()) return false;
      return this._isEntityControllable(id.trim());
    });
    
    // Calculate space needed for toggle: toggle width (40px) + margin (15px) + spacing from text (15px) = 70px
    const toggleSpace = hasTogglesInverter ? 70 : 0;
    
    const contentWidth = Math.max(200, Math.min(500, maxTextWidth));
    const calculatedPopupWidth = contentWidth + 40 + toggleSpace; // 40px padding + space for toggle if present
    
    // Calculate height based on content: top padding + lines + bottom padding
    const topPadding = 20;
    const bottomPadding = 20;
    const contentHeight = lines.length * lineHeight;
    const calculatedPopupHeight = topPadding + contentHeight + bottomPadding;
    
    // Use positions from config if available, otherwise center (Inverter popup)
    const popupX = Number(config.dev_popup_inverter_x) || (800 - calculatedPopupWidth) / 2;
    const popupY = Number(config.dev_popup_inverter_y) || (450 - calculatedPopupHeight) / 2;
    const popupWidth = Number(config.dev_popup_inverter_width) || calculatedPopupWidth;
    const popupHeight = Number(config.dev_popup_inverter_height) || calculatedPopupHeight;
    
    // Update popup rectangle
    const rect = popup.querySelector('rect');
    if (rect) {
      rect.setAttribute('x', popupX);
      rect.setAttribute('y', popupY);
      rect.setAttribute('width', popupWidth);
      rect.setAttribute('height', popupHeight);
      // Ensure popup background is semi-transparent and shows thin glowing border (hologram effect)
      rect.setAttribute('fill', '#001428');
      rect.setAttribute('fill-opacity', '0.8');
      rect.setAttribute('stroke', '#00FFFF');
      rect.setAttribute('stroke-width', '0.5');
    }
    
    // Update text positions and styling with toggles
    const lineElements = this._domRefs.inverterPopupLines || [];
    const lineGroups = this._domRefs.inverterPopupLineGroups || [];
    const toggleElements = this._domRefs.inverterPopupToggles || [];
    
    // Use already calculated popupWidth which includes toggle space
    const adjustedPopupWidth = popupWidth;
    if (rect) {
      rect.setAttribute('width', adjustedPopupWidth);
    }
    
    lines.forEach((line, index) => {
      const element = lineElements[index];
      const group = lineGroups[index];
      const toggle = toggleElements[index];
      const sensorId = popupInverterSensorIds[index];
      
      if (element && group) {
        const yPos = popupY + topPadding + (index * lineHeight) + (lineHeight / 2);
        // Adjust text position if toggle is present: move text left to make room for toggle
        const isControllable = sensorId && typeof sensorId === 'string' && sensorId.trim() && this._isEntityControllable(sensorId.trim());
        const textOffset = isControllable ? -35 : 0; // Move text left by 35px if toggle is present
        element.setAttribute('x', popupX + adjustedPopupWidth / 2 + textOffset);
        element.setAttribute('y', yPos);
        element.textContent = line;
        element.style.display = 'inline';
        
        // Apply font size
        const fontSizeKey = `sensor_popup_inverter_${index + 1}_font_size`;
        const fontSize = config[fontSizeKey] || 16;
        element.setAttribute('font-size', fontSize);
        
        // Apply color
        const colorKey = `sensor_popup_inverter_${index + 1}_color`;
        const color = config[colorKey] || '#80ffff';
        element.setAttribute('fill', color);
        
        // Show group
        group.style.display = 'inline';
        
        // Check if entity is controllable and show toggle (reuse isControllable from above)
        if (isControllable && toggle) {
          const trimmedSensorId = sensorId.trim();
          // Position toggle: popupX + popupWidth - toggleWidth - 15px margin from right edge
          // Adjust vertical alignment: raise toggle by 2px to better align with text
          const toggleWidth = 40; // Width of toggle switch
          const toggleX = popupX + adjustedPopupWidth - toggleWidth - 15;
          const toggleY = yPos - 6; // Raise toggle by 6px for better alignment
          toggle.setAttribute('transform', `translate(${toggleX}, ${toggleY})`);
          toggle.style.display = 'inline';
          
          // Set toggle to semi-transparent with cyan border
          const bgRect = toggle.querySelector('rect');
          if (bgRect) {
            bgRect.setAttribute('stroke', '#00FFFF');
            bgRect.setAttribute('stroke-width', '1.5');
            bgRect.setAttribute('opacity', '0.7');
            bgRect.style.stroke = '#00FFFF';
            bgRect.style.opacity = '0.7';
          }
          const sliderCircle = toggle.querySelector('circle');
          if (sliderCircle) {
            sliderCircle.setAttribute('opacity', '0.9');
            sliderCircle.style.opacity = '0.9';
          }
          
          // Update toggle state (on/off) using helper function
          this._updateToggleSwitch(toggle, trimmedSensorId);
          toggle.setAttribute('data-entity-id', trimmedSensorId);
        } else if (toggle) {
          toggle.style.display = 'none';
        }
      }
    });
    
    // Hide unused lines
    for (let i = lines.length; i < lineElements.length; i++) {
      const element = lineElements[i];
      const group = lineGroups[i];
      const toggle = toggleElements[i];
      if (element) {
        element.style.display = 'none';
      }
      if (group) {
        group.style.display = 'none';
      }
      if (toggle) {
        toggle.style.display = 'none';
      }
    }
    
    popup.style.display = 'inline';
    popup.style.opacity = '1';
    popup.style.transform = 'scale(1)';
    popup.style.pointerEvents = 'auto';
    // Prevent clicks on popup content from closing the popup
    (this._domRefs.inverterPopupLineGroups || []).forEach(group => {
      if (group) {
        group.style.pointerEvents = 'auto';
      }
    });
    this._activePopup = 'inverter';
    // Set a flag to prevent immediate closing after opening
    this._popupJustOpened = true;
    setTimeout(() => {
      this._popupJustOpened = false;
    }, 300);
    const gsap = await this._ensureGsap();
    if (gsap) {
      gsap.fromTo(popup, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.7)' });
    }
  }

  async _hideInverterPopup() {
    if (!this._domRefs || !this._domRefs.inverterPopup) {
      return;
    }
    const popup = this._domRefs.inverterPopup;
    const gsap = await this._ensureGsap();
    if (gsap) {
      gsap.to(popup, { opacity: 0, scale: 0.8, duration: 0.2, ease: 'power2.in', onComplete: () => {
        popup.style.display = 'none';
        if (this._activePopup === 'inverter') this._activePopup = null;
      }});
    } else {
      popup.style.display = 'none';
      if (this._activePopup === 'inverter') this._activePopup = null;
    }
  }

  _closeOtherPopups(except) {
    if (except !== 'pv') {
      this._hidePvPopup();
    }
    if (except !== 'battery') {
      this._hideBatteryPopup();
    }
    if (except !== 'house') {
      this._hideHousePopup();
    }
    if (except !== 'grid') {
      this._hideGridPopup();
    }
    if (except !== 'inverter') {
      this._hideInverterPopup();
    }
  }

  _updateView(viewState) {
    if (!this._domRefs) {
      this._cacheDomReferences();
    }
    const refs = this._domRefs;
    if (!refs) {
      return;
    }
    const root = this.shadowRoot;
    const config = this.config || {};

    // Get dynamic positions from config
    const TEXT_POSITIONS = getTextPositions(config);
    const TEXT_TRANSFORMS = {
      solar: buildTextTransform(TEXT_POSITIONS.solar),
      battery: buildTextTransform(TEXT_POSITIONS.battery),
      home: buildTextTransform(TEXT_POSITIONS.home),
      home_temperature: buildTextTransform(TEXT_POSITIONS.home_temperature),
      grid: buildTextTransform(TEXT_POSITIONS.grid),
      heatPump: buildTextTransform(TEXT_POSITIONS.heatPump),
      car1_label: buildTextTransform(TEXT_POSITIONS.car1_label),
      car2_label: buildTextTransform(TEXT_POSITIONS.car2_label),
      car1_power: buildTextTransform(TEXT_POSITIONS.car1_power),
      car1_soc: buildTextTransform(TEXT_POSITIONS.car1_soc),
      car2_power: buildTextTransform(TEXT_POSITIONS.car2_power),
      car2_soc: buildTextTransform(TEXT_POSITIONS.car2_soc)
    };

    const prev = this._prevViewState || {};
    
    // Check if text positions changed and update transforms
    const prevTextPositions = this._prevTextPositions || {};
    const textPositionsChanged = 
      JSON.stringify(prevTextPositions) !== JSON.stringify(TEXT_POSITIONS);
    
    // Check if config has developer values - if so, always update transforms
    const hasDeveloperValues = this.config && Object.keys(this.config).some(key => 
      key.startsWith('dev_text_') || 
      key.startsWith('dev_popup_') || 
      key.startsWith('dev_soc_bar_') || key.startsWith('soc_bar_') || key.startsWith('dev_grid_box_') || key.startsWith('dev_pv_box_')
    );
    
    const shouldUpdateTransforms = textPositionsChanged || hasDeveloperValues;
    
    if (shouldUpdateTransforms) {
      this._prevTextPositions = JSON.parse(JSON.stringify(TEXT_POSITIONS));
      
      if (refs.pvLines && refs.pvLines.length) {
        refs.pvLines.forEach((node) => {
          if (node) {
            node.setAttribute('x', TEXT_POSITIONS.solar.x);
            node.setAttribute('transform', TEXT_TRANSFORMS.solar);
          }
        });
      }
      
      if (refs.batterySoc) {
        refs.batterySoc.setAttribute('x', TEXT_POSITIONS.battery.x);
        refs.batterySoc.setAttribute('y', TEXT_POSITIONS.battery.y);
        refs.batterySoc.setAttribute('transform', TEXT_TRANSFORMS.battery);
      }
      
      if (refs.batteryPower) {
        refs.batteryPower.setAttribute('x', TEXT_POSITIONS.battery.x);
        refs.batteryPower.setAttribute('y', TEXT_POSITIONS.battery.y + 20);
        refs.batteryPower.setAttribute('transform', TEXT_TRANSFORMS.battery);
      }
      
      if (refs.loadText) {
        refs.loadText.setAttribute('x', TEXT_POSITIONS.home.x);
        refs.loadText.setAttribute('y', TEXT_POSITIONS.home.y);
        refs.loadText.setAttribute('transform', TEXT_TRANSFORMS.home);
      }
      
      if (refs.loadLines && refs.loadLines.length) {
        const baseY = TEXT_POSITIONS.home.y;
        const lineSpacing = (viewState.load && viewState.load.fontSize) || 16 + 4;
        refs.loadLines.forEach((node, idx) => {
          if (node) {
            node.setAttribute('x', TEXT_POSITIONS.home.x);
            node.setAttribute('y', baseY + idx * lineSpacing);
            node.setAttribute('transform', TEXT_TRANSFORMS.home);
          }
        });
      }
      
      
      if (refs.gridText) {
        refs.gridText.setAttribute('x', TEXT_POSITIONS.grid.x);
        refs.gridText.setAttribute('y', TEXT_POSITIONS.grid.y);
        refs.gridText.setAttribute('transform', TEXT_TRANSFORMS.grid);
      }
      
      if (refs.heatPumpText) {
        refs.heatPumpText.setAttribute('x', TEXT_POSITIONS.heatPump.x);
        refs.heatPumpText.setAttribute('y', TEXT_POSITIONS.heatPump.y);
        refs.heatPumpText.setAttribute('transform', TEXT_TRANSFORMS.heatPump);
      }
      
      
      if (refs.car1Label) {
        refs.car1Label.setAttribute('x', TEXT_POSITIONS.car1_label.x);
        refs.car1Label.setAttribute('y', TEXT_POSITIONS.car1_label.y);
        refs.car1Label.setAttribute('transform', TEXT_TRANSFORMS.car1_label);
      }
      if (refs.car1Power) {
        refs.car1Power.setAttribute('x', TEXT_POSITIONS.car1_power.x);
        refs.car1Power.setAttribute('y', TEXT_POSITIONS.car1_power.y);
        refs.car1Power.setAttribute('transform', TEXT_TRANSFORMS.car1_power);
      }
      if (refs.car1Soc) {
        refs.car1Soc.setAttribute('x', TEXT_POSITIONS.car1_soc.x);
        refs.car1Soc.setAttribute('y', TEXT_POSITIONS.car1_soc.y);
        refs.car1Soc.setAttribute('transform', TEXT_TRANSFORMS.car1_soc);
      }
      if (refs.car2Label) {
        refs.car2Label.setAttribute('x', TEXT_POSITIONS.car2_label.x);
        refs.car2Label.setAttribute('y', TEXT_POSITIONS.car2_label.y);
        refs.car2Label.setAttribute('transform', TEXT_TRANSFORMS.car2_label);
      }
      if (refs.car2Power) {
        refs.car2Power.setAttribute('x', TEXT_POSITIONS.car2_power.x);
        refs.car2Power.setAttribute('y', TEXT_POSITIONS.car2_power.y);
        refs.car2Power.setAttribute('transform', TEXT_TRANSFORMS.car2_power);
      }
      if (refs.car2Soc) {
        refs.car2Soc.setAttribute('x', TEXT_POSITIONS.car2_soc.x);
        refs.car2Soc.setAttribute('y', TEXT_POSITIONS.car2_soc.y);
        refs.car2Soc.setAttribute('transform', TEXT_TRANSFORMS.car2_soc);
      }
    }
    const animationStyle = viewState.animationStyle || FLOW_STYLE_DEFAULT;
    const useArrowsGlobally = animationStyle === 'arrows';
    const styleChanged = prev.animationStyle !== viewState.animationStyle;

    if (refs.background && prev.backgroundImage !== viewState.backgroundImage) {
      refs.background.setAttribute('href', viewState.backgroundImage);
      refs.background.setAttribute('xlink:href', viewState.backgroundImage);
    }

    // Update overlay images (1-5)
    if (refs.overlayImages) {
      viewState.overlayImages.forEach((overlay, index) => {
        const ref = refs.overlayImages[index];
        if (ref) {
          const prevOverlay = prev.overlayImages && prev.overlayImages[index];
          const overlayChanged = !prevOverlay ||
            prevOverlay.enabled !== overlay.enabled ||
            prevOverlay.image !== overlay.image ||
            prevOverlay.x !== overlay.x ||
            prevOverlay.y !== overlay.y ||
            prevOverlay.width !== overlay.width ||
            prevOverlay.height !== overlay.height ||
            prevOverlay.opacity !== overlay.opacity;

          if (overlayChanged) {
            if (overlay.enabled && overlay.image) {
              ref.setAttribute('href', overlay.image);
              ref.setAttribute('xlink:href', overlay.image);
              ref.setAttribute('x', overlay.x);
              ref.setAttribute('y', overlay.y);
              ref.setAttribute('width', overlay.width);
              ref.setAttribute('height', overlay.height);
              ref.style.opacity = overlay.opacity;
              ref.style.display = 'inline';
            } else {
              ref.style.display = 'none';
            }
          }
        }
      });
    }

    // Legacy overlay image update for backward compatibility
    if (refs.overlayImage && (prev.overlayImage !== viewState.overlayImage || prev.overlayImageX !== viewState.overlayImageX || prev.overlayImageY !== viewState.overlayImageY || prev.overlayImageWidth !== viewState.overlayImageWidth || prev.overlayImageHeight !== viewState.overlayImageHeight || prev.overlayImageOpacity !== viewState.overlayImageOpacity)) {
      if (viewState.overlayImage) {
        refs.overlayImage.setAttribute('href', viewState.overlayImage);
        refs.overlayImage.setAttribute('xlink:href', viewState.overlayImage);
        refs.overlayImage.setAttribute('x', viewState.overlayImageX);
        refs.overlayImage.setAttribute('y', viewState.overlayImageY);
        refs.overlayImage.setAttribute('width', viewState.overlayImageWidth);
        refs.overlayImage.setAttribute('height', viewState.overlayImageHeight);
        refs.overlayImage.style.opacity = viewState.overlayImageOpacity;
        refs.overlayImage.style.display = 'inline';
      } else {
        refs.overlayImage.style.display = 'none';
      }
    }

    if (refs.debugGrid) {
      const desired = viewState.showDebugGrid ? 'inline' : 'none';
      if (refs.debugGrid.style.display !== desired) {
        refs.debugGrid.style.display = desired;
      }
    }

    if (refs.debugCoords) {
      if (viewState.showDebugGrid) {
        if (refs.debugCoords.style.display !== 'block') {
          refs.debugCoords.style.display = 'block';
        }
        if (!this._debugCoordsActive) {
          this._setDebugCoordinateText(null, null);
        }
      } else {
        if (refs.debugCoords.style.display !== 'none') {
          refs.debugCoords.style.display = 'none';
        }
        this._setDebugCoordinateText(null, null);
      }
    }

    if (refs.title) {
      if (!prev.title || prev.title.text !== viewState.title.text) {
        refs.title.textContent = viewState.title.text;
      }
      if (!prev.title || prev.title.fontSize !== viewState.title.fontSize) {
        refs.title.setAttribute('font-size', viewState.title.fontSize);
      }
    }

    if (refs.socBarGroup && viewState.socBar) {
      const sb = viewState.socBar;
      const w = sb.width ?? 30;
      const h = sb.height ?? 85;
      const transform = `translate(${sb.x ?? 325}, ${sb.y ?? 277}) translate(${w / 2}, ${h / 2}) rotate(${sb.rotate ?? 0}) skewX(${sb.skewX ?? 1}) skewY(${sb.skewY ?? -18}) translate(${-w / 2}, ${-h / 2})`;
      if (refs.socBarGroup.getAttribute('transform') !== transform) {
        refs.socBarGroup.setAttribute('transform', transform);
      }
      const display = (sb.visible !== false && !viewState.hidePvAndBattery) ? 'inline' : 'none';
      if (refs.socBarGroup.style.display !== display) {
        refs.socBarGroup.style.display = display;
      }
      const segH = (h - 7) / 6;
      const colorOn = sb.colorOn ?? '#00FFFF';
      const colorOff = sb.colorOff ?? '#5aa7c3';
      const glow = sb.glow ?? 5;
      const opacity = sb.opacity ?? 0.35;
      const isCharging = viewState.battery && viewState.battery.isCharging;
      // Phase A Optimization: Batch DOM updates for SOC bar segments (reduces reflows)
      const socBarUpdates = [];
      refs.socBarSegments.forEach((el, i) => {
        if (!el) return;
        const thresh = (6 - i) * (100 / 6);
        const lit = (sb.soc ?? 0) >= thresh;
        const isFirstSegment = (i === 5);
        const fill = lit ? (isFirstSegment ? '#E53935' : 'url(#soc-bar-on-grad)') : colorOff;
        const y = 1 + i * (segH + 1);
        const glowColor = isFirstSegment && lit ? '#E53935' : colorOn;
        const filter = lit && glow > 0 ? `drop-shadow(0 0 ${glow}px ${glowColor}) drop-shadow(0 0 ${Math.round(glow / 2)}px rgba(255,255,255,0.4))` : 'none';
        const shouldPulse = isCharging && lit;
        
        // Batch DOM updates
        socBarUpdates.push(() => {
          if (el.getAttribute('fill') !== fill) el.setAttribute('fill', fill);
          if (el.getAttribute('fill-opacity') !== String(opacity)) el.setAttribute('fill-opacity', String(opacity));
          if (el.getAttribute('y') !== String(y)) el.setAttribute('y', String(y));
          if (el.getAttribute('x') !== '2') el.setAttribute('x', '2');
          if (el.getAttribute('width') !== String(w - 4)) el.setAttribute('width', String(w - 4));
          if (el.getAttribute('height') !== String(segH)) el.setAttribute('height', String(segH));
          if (el.style.filter !== filter) el.style.filter = filter;
          if (el.getAttribute('stroke') !== 'transparent') el.setAttribute('stroke', 'transparent');
          if (el.getAttribute('stroke-width') !== '0') el.setAttribute('stroke-width', '0');
          if (shouldPulse && !el.classList.contains('soc-bar-pulse')) {
            el.classList.add('soc-bar-pulse');
          } else if (!shouldPulse && el.classList.contains('soc-bar-pulse')) {
            el.classList.remove('soc-bar-pulse');
          }
        });
      });
      
      // Execute all SOC bar updates in a single batch (1 reflow instead of 6)
      if (socBarUpdates.length > 0) {
        requestAnimationFrame(() => {
          for (let i = 0; i < socBarUpdates.length; i++) {
            socBarUpdates[i]();
          }
        });
      }
    }

    // Phase A Optimization: Batch DOM updates for PV lines (reduces reflows)
    if (refs.pvLines && refs.pvLines.length) {
      const pvLineUpdates = [];
      viewState.pv.lines.forEach((line, index) => {
        const node = refs.pvLines[index];
        if (!node) {
          return;
        }
        const prevLine = prev.pv && prev.pv.lines ? prev.pv.lines[index] : undefined;
        
        // Batch DOM updates
        pvLineUpdates.push(() => {
          if (!prevLine || prevLine.text !== line.text) {
            node.textContent = line.text;
          }
          if (!prevLine || prevLine.fill !== line.fill) {
            node.setAttribute('fill', line.fill);
          }
          if (!prev.pv || prev.pv.fontSize !== viewState.pv.fontSize) {
            node.setAttribute('font-size', viewState.pv.fontSize);
          }
          if (!prevLine || prevLine.y !== line.y) {
            node.setAttribute('y', line.y);
          }
          const display = line.visible ? 'inline' : 'none';
          if (node.style.display !== display) {
            node.style.display = display;
          }
        });
      });
      
      // Execute all PV line updates in a single batch (1 reflow instead of N)
      if (pvLineUpdates.length > 0) {
        requestAnimationFrame(() => {
          for (let i = 0; i < pvLineUpdates.length; i++) {
            pvLineUpdates[i]();
          }
        });
      }
    }

    if (refs.pvClickableArea) {
      const display = viewState.pvUiEnabled ? 'inline' : 'none';
      if (refs.pvClickableArea.style.display !== display) {
        refs.pvClickableArea.style.display = display;
      }
      const cursor = viewState.pvUiEnabled ? 'pointer' : 'default';
      if (refs.pvClickableArea.style.cursor !== cursor) {
        refs.pvClickableArea.style.cursor = cursor;
      }
    }

    if (!viewState.pvUiEnabled && refs.pvPopup) {
      if (refs.pvPopup.style.display !== 'none') {
        refs.pvPopup.style.display = 'none';
      }
      if (this._activePopup === 'pv') {
        this._activePopup = null;
      }
      if (refs.pvClickableArea) {
        refs.pvClickableArea.style.pointerEvents = 'all';
      }
    }

    if (refs.batterySoc) {
      if (!prev.batterySoc || prev.batterySoc.text !== viewState.batterySoc.text) {
        refs.batterySoc.textContent = viewState.batterySoc.text;
      }
      if (!prev.batterySoc || prev.batterySoc.fill !== viewState.batterySoc.fill) {
        refs.batterySoc.setAttribute('fill', viewState.batterySoc.fill);
      }
      if (!prev.batterySoc || prev.batterySoc.fontSize !== viewState.batterySoc.fontSize) {
        refs.batterySoc.setAttribute('font-size', viewState.batterySoc.fontSize);
      }
    }

    if (refs.batteryPower) {
      if (!prev.batteryPower || prev.batteryPower.text !== viewState.batteryPower.text) {
        refs.batteryPower.textContent = viewState.batteryPower.text;
      }
      if (!prev.batteryPower || prev.batteryPower.fill !== viewState.batteryPower.fill) {
        refs.batteryPower.setAttribute('fill', viewState.batteryPower.fill);
      }
      if (!prev.batteryPower || prev.batteryPower.fontSize !== viewState.batteryPower.fontSize) {
        refs.batteryPower.setAttribute('font-size', viewState.batteryPower.fontSize);
      }
    }

    if (refs.loadText) {
      const lines = viewState.load && viewState.load.lines && viewState.load.lines.length ? viewState.load.lines : null;
      if (lines) {
        // Multi-line mode: update individual load-line nodes
        if (refs.loadLines && refs.loadLines.length) {
          const baseY = viewState.load.y || TEXT_POSITIONS.home.y;
          const lineSpacing = viewState.load.fontSize + 4;
          // Phase A Optimization: Batch DOM updates for load lines (reduces reflows)
          const loadLineUpdates = [];
          lines.forEach((l, idx) => {
            const node = refs.loadLines[idx];
            if (!node) return;
            const desiredY = baseY + idx * lineSpacing;
            
            loadLineUpdates.push(() => {
              if (!prev.load || !prev.load.lines || (prev.load.lines[idx] || {}).text !== l.text) {
                node.textContent = l.text;
              }
              if (!prev.load || !prev.load.lines || (prev.load.lines[idx] || {}).fill !== l.fill) {
                node.setAttribute('fill', l.fill || viewState.load.fill);
              }
              if (!prev.load || prev.load.fontSize !== viewState.load.fontSize) {
                node.setAttribute('font-size', viewState.load.fontSize);
              }
              if (!prev.load || prev.load.y !== desiredY) {
                node.setAttribute('y', desiredY);
              }
              if (node.style.display !== 'inline') node.style.display = 'inline';
            });
          });
          // hide unused lines (also batched)
          for (let i = lines.length; i < refs.loadLines.length; i++) {
            const node = refs.loadLines[i];
            if (node) {
              loadLineUpdates.push(() => {
                if (node.style.display !== 'none') node.style.display = 'none';
              });
            }
          }
          
          // Execute all load line updates in a single batch (1 reflow instead of N)
          if (loadLineUpdates.length > 0) {
            requestAnimationFrame(() => {
              for (let i = 0; i < loadLineUpdates.length; i++) {
                loadLineUpdates[i]();
              }
            });
          }
        }
        // hide single-line element
        if (refs.loadText.style.display !== 'none') refs.loadText.style.display = 'none';
      } else {
        // Single-line mode
        if (!prev.load || prev.load.text !== viewState.load.text) {
          refs.loadText.textContent = viewState.load.text || '';
        }
        // restore default y if previously modified
        if (!prev.load || prev.load.y !== undefined) {
          refs.loadText.setAttribute('y', TEXT_POSITIONS.home.y);
        }
        // Phase A Optimization: Batch DOM updates for hiding load lines
        if (refs.loadLines && refs.loadLines.length) {
          const hideUpdates = [];
          refs.loadLines.forEach((node) => {
            if (node && node.style.display !== 'none') {
              hideUpdates.push(() => {
                node.style.display = 'none';
              });
            }
          });
          if (hideUpdates.length > 0) {
            requestAnimationFrame(() => {
              for (let i = 0; i < hideUpdates.length; i++) {
                hideUpdates[i]();
              }
            });
          }
        }
        if (refs.loadText.style.display !== 'inline') refs.loadText.style.display = 'inline';
      }
      if (!prev.load || prev.load.fill !== viewState.load.fill) {
        refs.loadText.setAttribute('fill', viewState.load.fill);
      }
      if (!prev.load || prev.load.fontSize !== viewState.load.fontSize) {
        refs.loadText.setAttribute('font-size', viewState.load.fontSize);
      }
    }

    // Update house temperature text
    if (refs.houseTemperatureGroup && refs.houseTempText) {
      const ht = viewState.houseTemperature;
      const tempVisible = ht && ht.visible;
      if (refs.houseTemperatureGroup.style.display !== (tempVisible ? 'inline' : 'none')) {
        refs.houseTemperatureGroup.style.display = tempVisible ? 'inline' : 'none';
      }
      const val = ht && ht.value;
      const text = tempVisible ? (val != null ? `${Number(val).toFixed(1)} °C` : '--') : '';
      if (refs.houseTempText.textContent !== text) refs.houseTempText.textContent = text;
      if (ht && ht.fill && refs.houseTempText.getAttribute('fill') !== ht.fill) refs.houseTempText.setAttribute('fill', ht.fill);
      if (ht && ht.fontSize != null && refs.houseTempText.getAttribute('font-size') !== String(ht.fontSize)) refs.houseTempText.setAttribute('font-size', String(ht.fontSize));
    }

    if (refs.gridText) {
      if (!prev.grid || prev.grid.text !== viewState.grid.text) {
        refs.gridText.textContent = viewState.grid.text || '';
      }
      if (!prev.grid || prev.grid.fill !== viewState.grid.fill) {
        refs.gridText.setAttribute('fill', viewState.grid.fill);
      }
      if (!prev.grid || prev.grid.fontSize !== viewState.grid.fontSize) {
        refs.gridText.setAttribute('font-size', viewState.grid.fontSize);
      }
    }

    if (refs.gridBoxGroup && viewState.gridBox) {
      const gb = viewState.gridBox;
      const t = `translate(${gb.x ?? 580}, ${gb.y ?? 15})`;
      if (refs.gridBoxGroup.getAttribute('transform') !== t) refs.gridBoxGroup.setAttribute('transform', t);
      refs.gridBoxGroup.style.display = gb.visible ? 'inline' : 'none';
      const rect = refs.gridBoxGroup.querySelector('rect');
      if (rect && (rect.getAttribute('width') !== String(gb.width ?? 200) || rect.getAttribute('height') !== String(gb.height ?? 85))) {
        rect.setAttribute('width', gb.width ?? 200);
        rect.setAttribute('height', gb.height ?? 85);
      }
      (gb.lines || []).forEach((line, i) => {
        const el = refs.gridBoxLines[i];
        if (!el) return;
        const text = `${line.label}: ${line.value}`;
        if (el.textContent !== text) el.textContent = text;
        if (el.getAttribute('fill') !== (line.fill || '#00FFFF')) el.setAttribute('fill', line.fill || '#00FFFF');
        const fy = (gb.startY ?? 14) + i * (gb.lineHeight ?? 18);
        const fs = gb.fontSize ?? 12;
        const cx = (gb.width ?? 200) / 2;
        if (el.getAttribute('y') !== String(fy)) el.setAttribute('y', fy);
        if (el.getAttribute('x') !== String(cx)) el.setAttribute('x', cx);
        if (el.getAttribute('font-size') !== String(fs)) el.setAttribute('font-size', fs);
      });
    }

    if (refs.pvBoxGroup && viewState.pvBox) {
      const pb = viewState.pvBox;
      const t = `translate(${pb.x ?? 20}, ${pb.y ?? 15})`;
      if (refs.pvBoxGroup.getAttribute('transform') !== t) refs.pvBoxGroup.setAttribute('transform', t);
      refs.pvBoxGroup.style.display = pb.visible ? 'inline' : 'none';
      const rect = refs.pvBoxGroup.querySelector('rect');
      if (rect && (rect.getAttribute('width') !== String(pb.width ?? 200) || rect.getAttribute('height') !== String(pb.height ?? 85))) {
        rect.setAttribute('width', pb.width ?? 200);
        rect.setAttribute('height', pb.height ?? 85);
      }
      (pb.lines || []).forEach((line, i) => {
        const el = refs.pvBoxLines[i];
        if (!el) return;
        const text = `${line.label}: ${line.value}`;
        if (el.textContent !== text) el.textContent = text;
        if (el.getAttribute('fill') !== (line.fill || '#00FFFF')) el.setAttribute('fill', line.fill || '#00FFFF');
        const fy = (pb.startY ?? 14) + i * (pb.lineHeight ?? 18);
        const fs = pb.fontSize ?? 12;
        const cx = (pb.width ?? 200) / 2;
        if (el.getAttribute('y') !== String(fy)) el.setAttribute('y', fy);
        if (el.getAttribute('x') !== String(cx)) el.setAttribute('x', cx);
        if (el.getAttribute('font-size') !== String(fs)) el.setAttribute('font-size', fs);
      });
    }

    if (refs.heatPumpText && viewState.heatPump) {
      const nextHeatPump = viewState.heatPump;
      const prevHeatPump = prev.heatPump || {};
      const isVisible = Boolean(nextHeatPump.visible);
      const desiredDisplay = isVisible ? 'inline' : 'none';
      if (refs.heatPumpText.style.display !== desiredDisplay) {
        refs.heatPumpText.style.display = desiredDisplay;
      }
      if (isVisible) {
        if (!prev.heatPump || prevHeatPump.text !== nextHeatPump.text) {
          refs.heatPumpText.textContent = nextHeatPump.text;
        }
        if (!prev.heatPump || prevHeatPump.fill !== nextHeatPump.fill) {
          refs.heatPumpText.setAttribute('fill', nextHeatPump.fill);
        }
        if (!prev.heatPump || prevHeatPump.fontSize !== nextHeatPump.fontSize) {
          refs.heatPumpText.setAttribute('font-size', nextHeatPump.fontSize);
        }
      } else if (refs.heatPumpText.textContent !== '') {
        refs.heatPumpText.textContent = '';
      }
    }

    const syncCarText = (node, viewEntry, prevEntry, displayFlag) => {
      if (!node || !viewEntry) {
        return;
      }
      const desiredDisplay = displayFlag ? 'inline' : 'none';
      if (node.style.display !== desiredDisplay) {
        node.style.display = desiredDisplay;
      }
      if (!displayFlag) {
        return;
      }
      if (!prevEntry || prevEntry.text !== viewEntry.text) {
        node.textContent = viewEntry.text;
      }
      if (!prevEntry || prevEntry.fill !== viewEntry.fill) {
        node.setAttribute('fill', viewEntry.fill);
      }
      if (!prevEntry || prevEntry.fontSize !== viewEntry.fontSize) {
        node.setAttribute('font-size', viewEntry.fontSize);
      }
      if (!prevEntry || prevEntry.x !== viewEntry.x) {
        node.setAttribute('x', viewEntry.x);
      }
      if (!prevEntry || prevEntry.y !== viewEntry.y) {
        node.setAttribute('y', viewEntry.y);
      }
      if (!prevEntry || prevEntry.transform !== viewEntry.transform) {
        node.setAttribute('transform', viewEntry.transform);
      }
    };

    const syncCarSection = (key) => {
      const carView = viewState[key];
      if (!carView) {
        return;
      }
      const prevCar = prev[key] || {};
      syncCarText(refs[`${key}Label`], carView.label, prevCar.label, carView.visible);
      syncCarText(refs[`${key}Power`], carView.power, prevCar.power, carView.visible);
      syncCarText(refs[`${key}Soc`], carView.soc, prevCar.soc, carView.soc.visible);
    };

    syncCarSection('car1');
    syncCarSection('car2');

    // Update custom texts
    if (viewState.customTexts && Array.isArray(viewState.customTexts)) {
      viewState.customTexts.forEach((ct, index) => {
        const textEl = refs.customTexts && refs.customTexts[index];
        if (textEl) {
          const prevText = prev.customTexts && prev.customTexts[index];
          if (!prevText || prevText.text !== ct.text) {
            textEl.textContent = ct.text;
          }
          if (!prevText || prevText.x !== ct.x) {
            textEl.setAttribute('x', ct.x);
          }
          if (!prevText || prevText.y !== ct.y) {
            textEl.setAttribute('y', ct.y);
          }
          if (!prevText || prevText.color !== ct.color) {
            textEl.setAttribute('fill', ct.color);
          }
          if (!prevText || prevText.size !== ct.size) {
            textEl.setAttribute('font-size', ct.size);
          }
        }
      });
    }

    // Update custom flow group visibility based on viewState.flows
    // Show the group if the flow is enabled and active (sensor value above threshold)
    for (let i = 1; i <= 5; i++) {
      const flowKey = `custom_flow_${i}`;
      const group = root.querySelector(`[data-custom-flow-group="${i}"]`);
      if (group) {
        const flowState = viewState.flows[flowKey];
        const isEnabled = this.config && Boolean(this.config[`custom_flow_${i}_enabled`]);
        // Show group only if enabled AND flow exists in viewState (has valid sensor/path) AND active
        const isActive = flowState && flowState.active === true;
        group.style.display = (isEnabled && flowState && isActive) ? 'inline' : 'none';
      }
    }

    // Update battery fill color
    if (viewState.battery && viewState.battery.fill) {
      const batteryFillElement = root.querySelector('[data-role="battery-liquid-shape"]') || root.querySelector('[data-role="battery-fill"]');
      if (batteryFillElement && (!prev.battery || prev.battery.fill !== viewState.battery.fill)) {
        batteryFillElement.setAttribute('fill', viewState.battery.fill);
      }
    }

    // Update linea box paths
    if (refs.lineaBox1 && config.linea_box_1_path) {
      const path1 = config.linea_box_1_path || 'M 664,130 730,95 V 82';
      if (refs.lineaBox1.getAttribute('d') !== path1) {
        refs.lineaBox1.setAttribute('d', path1);
      }
    }
    if (refs.lineaBox2 && config.linea_box_2_path) {
      const path2 = config.linea_box_2_path || 'M 17,200 8.9,190 9.2,83 89,76';
      if (refs.lineaBox2.getAttribute('d') !== path2) {
        refs.lineaBox2.setAttribute('d', path2);
      }
    }

    // PV popup lines are updated in _showPvPopup when needed
    // Update toggle switches if popup is open
    if (this._domRefs && this._activePopup) {
      setTimeout(() => {
        this._updateAllToggleSwitches();
      }, 50);
    }

    const prevFlows = prev.flows || {};
    Object.entries(viewState.flows).forEach(([key, flowState]) => {
      const element = refs.flows ? refs.flows[key] : null;
      const arrowGroup = useArrowsGlobally && refs.arrows ? refs.arrows[key] : null;
      const arrowShapes = useArrowsGlobally && refs.arrowShapes ? refs.arrowShapes[key] : null;
      if (!element) {
        return;
      }
      const prevFlow = prevFlows[key] || {};
      const activeChanged = prevFlow.active !== flowState.active;
      const directionChanged = prevFlow.direction !== flowState.direction;
      const pathChanged = prev.flowPaths && prev.flowPaths[key] !== viewState.flowPaths[key];
      
      if (prevFlow.stroke !== flowState.stroke) {
        element.setAttribute('stroke', flowState.stroke);
      }
      // Update data-direction attribute for shimmer flows (CSS handles animation direction)
      const animationStyle = element.getAttribute('data-flow-style');
      if (animationStyle === 'shimmer' && directionChanged) {
        const directionAttr = (flowState.direction < 0) ? '-1' : '1';
        element.setAttribute('data-direction', directionAttr);
        // Also update shimmer overlay paths if they exist
        const entry = this._flowTweens.get(key);
        if (entry && entry.shimmerOverlay && entry.shimmerOverlay.paths) {
          entry.shimmerOverlay.paths.forEach((path) => {
            if (path) {
              path.setAttribute('data-direction', directionAttr);
            }
          });
        }
      }
      if (useArrowsGlobally && arrowShapes && arrowShapes.length && (prevFlow.stroke !== flowState.stroke || prevFlow.glowColor !== flowState.glowColor)) {
        arrowShapes.forEach((shape) => {
          shape.setAttribute('fill', flowState.glowColor || flowState.stroke);
        });
      }
      // Update base path opacity. For shimmer, we use a very faint background path
      // so only the shimmer pulse is clearly visible.
      const isShimmer = animationStyle === 'shimmer';
      const pathOpacity = flowState.active ? (isShimmer ? '0.1' : '1') : '0';
      // Always update opacity to ensure visibility is correct, especially for battery flow
      element.style.opacity = pathOpacity;
      
      // If active state or direction changed, force re-sync the animation
      if (activeChanged || directionChanged) {
        const entry = this._flowTweens.get(key);
        if (entry) {
          // Force re-sync to ensure animation updates correctly
          this._syncFlowAnimation(key, element, flowState.active ? 1 : 0, flowState);
        }
      }
      
      if (!this._flowTweens.get(key)) {
        this._setFlowGlow(element, flowState.glowColor || flowState.stroke, flowState.active ? 0.8 : 0.25);
        if (useArrowsGlobally && arrowGroup) {
          const arrowOpacity = flowState.active ? '1' : '0';
          if (arrowGroup.style.opacity !== arrowOpacity) {
            arrowGroup.style.opacity = arrowOpacity;
          }
          if (!flowState.active && arrowShapes && arrowShapes.length) {
            arrowShapes.forEach((shape) => shape.removeAttribute('transform'));
          }
        }
      } else if (useArrowsGlobally && arrowGroup) {
        const arrowOpacity = flowState.active ? '1' : '0';
        if (arrowGroup.style.opacity !== arrowOpacity) {
          arrowGroup.style.opacity = arrowOpacity;
        }
        if (!flowState.active && arrowShapes && arrowShapes.length) {
          arrowShapes.forEach((shape) => shape.removeAttribute('transform'));
        }
      }

      if (!useArrowsGlobally && refs.arrows && refs.arrows[key] && (styleChanged || refs.arrows[key].style.opacity !== '0')) {
        refs.arrows[key].style.opacity = '0';
        if (refs.arrowShapes && refs.arrowShapes[key]) {
          refs.arrowShapes[key].forEach((shape) => shape.removeAttribute('transform'));
        }
      }
    });

    if (refs.flows && viewState.flowPaths) {
      Object.entries(viewState.flowPaths).forEach(([key, dValue]) => {
        const element = refs.flows[key];
        if (!element || typeof dValue !== 'string') {
          return;
        }
        if (element.getAttribute('d') !== dValue) {
          element.setAttribute('d', dValue);
          
          // Also update track path
          const trackPath = element.parentNode ? element.parentNode.querySelector('.track-path') : null;
          if (trackPath) {
            trackPath.setAttribute('d', dValue);
          }
          
          // Reset path length cache
          if (this._flowPathLengths && this._flowPathLengths.has(key)) {
            this._flowPathLengths.delete(key);
          }
          
          // Reset shimmer overlay if it exists
          const entry = this._flowTweens.get(key);
          if (entry && entry.mode === 'shimmer') {
            this._removeShimmerOverlay(key, element);
            entry.shimmerOverlay = null;
            // Force re-sync
            this._syncFlowAnimation(key, element, viewState.flows[key] && viewState.flows[key].active ? 1 : 0, viewState.flows[key]);
          }
        }
      });
    }

    // Re-attach event listeners after DOM updates
    this._cacheDomReferences(); // Re-cache refs in case DOM was updated
    this._attachEventListeners();
    
    // Update toggle switches if popup is open
    if (this._activePopup) {
      setTimeout(() => {
        this._updateAllToggleSwitches();
      }, 50);
    }
  }

  _handleDebugPointerMove(event) {
    if (!DEBUG_GRID_ENABLED || !this._domRefs || !this._domRefs.svgRoot) {
      return;
    }
    const rect = this._domRefs.svgRoot.getBoundingClientRect();
    const width = rect.width || 0;
    const height = rect.height || 0;
    if (width === 0 || height === 0) {
      return;
    }
    const relativeX = ((event.clientX - rect.left) / width) * SVG_DIMENSIONS.width;
    const relativeY = ((event.clientY - rect.top) / height) * SVG_DIMENSIONS.height;
    this._setDebugCoordinateText(relativeX, relativeY);
  }

  _handleDebugPointerLeave() {
    if (!DEBUG_GRID_ENABLED) {
      return;
    }
    this._setDebugCoordinateText(null, null);
  }

  _handleTextMouseDown(event) {
    if (!DEBUG_GRID_ENABLED || event.button !== 0) {
      return;
    }
    let textElement = event.target;
    let role = textElement && textElement.getAttribute ? textElement.getAttribute('data-role') : null;
    if ((!role || !role.includes('-')) && event.currentTarget && event.currentTarget.getAttribute) {
      role = event.currentTarget.getAttribute('data-role');
      textElement = event.currentTarget;
    }
    if (!role || !role.includes('-')) {
      return;
    }
    event.preventDefault();
    this._draggingText = { element: textElement, role: role };
    const rect = this._domRefs.svgRoot.getBoundingClientRect();
    this._dragStartX = ((event.clientX - rect.left) / rect.width) * SVG_DIMENSIONS.width;
    this._dragStartY = ((event.clientY - rect.top) / rect.height) * SVG_DIMENSIONS.height;
  }

  _handleDocumentMouseMove(event) {
    if (!this._draggingText || !this._domRefs || !this._domRefs.svgRoot) {
      return;
    }
    const rect = this._domRefs.svgRoot.getBoundingClientRect();
    const currentX = ((event.clientX - rect.left) / rect.width) * SVG_DIMENSIONS.width;
    const currentY = ((event.clientY - rect.top) / rect.height) * SVG_DIMENSIONS.height;
    this._dragOffsetX = Math.round(currentX - this._dragStartX);
    this._dragOffsetY = Math.round(currentY - this._dragStartY);
  }

  _handleDocumentMouseUp(event) {
    if (!this._draggingText) {
      return;
    }
    const role = this._draggingText.role;
    const newX = Math.round(this._dragStartX + this._dragOffsetX);
    const newY = Math.round(this._dragStartY + this._dragOffsetY);
    
    // Aggiorna la configurazione con le nuove posizioni
    const textConfigs = {
      'pv-line': { xKey: 'dev_text_solar_x', yKey: 'dev_text_solar_y' },
      'battery-soc': { xKey: 'dev_text_battery_x', yKey: 'dev_text_battery_y' },
      'battery-power': { xKey: 'dev_text_battery_x', yKey: 'dev_text_battery_y' },
      'load-power': { xKey: 'dev_text_home_x', yKey: 'dev_text_home_y' },
      'heat-pump-power': { xKey: 'dev_text_heatpump_x', yKey: 'dev_text_heatpump_y' },
      'grid-power': { xKey: 'dev_text_grid_x', yKey: 'dev_text_grid_y' },
      'car1-label': { xKey: 'dev_text_car1_label_x', yKey: 'dev_text_car1_label_y' },
      'car1-power': { xKey: 'dev_text_car1_power_x', yKey: 'dev_text_car1_power_y' },
      'car1-soc': { xKey: 'dev_text_car1_soc_x', yKey: 'dev_text_car1_soc_y' },
      'car2-label': { xKey: 'dev_text_car2_label_x', yKey: 'dev_text_car2_label_y' },
      'car2-power': { xKey: 'dev_text_car2_power_x', yKey: 'dev_text_car2_power_y' },
      'car2-soc': { xKey: 'dev_text_car2_soc_x', yKey: 'dev_text_car2_soc_y' }
    };
    
    let configKey = null;
    for (const [key, config] of Object.entries(textConfigs)) {
      if (role.includes(key)) {
        configKey = config;
        break;
      }
    }
    
    if (configKey) {
      this.config[configKey.xKey] = newX;
      this.config[configKey.yKey] = newY;
      this._config[configKey.xKey] = newX;
      this._config[configKey.yKey] = newY;
      this._forceRender = true;
      this.render();
    }
    
    this._draggingText = null;
  }

  _setDebugCoordinateText(x, y) {
    if (!this._domRefs || !this._domRefs.debugCoords) {
      return;
    }
    const node = this._domRefs.debugCoords;
    if (x === null || y === null || Number.isNaN(Number(x)) || Number.isNaN(Number(y))) {
      node.textContent = 'X: ---, Y: ---';
      this._debugCoordsActive = false;
      return;
    }
    const clampedX = Math.max(0, Math.min(Math.round(x), SVG_DIMENSIONS.width));
    const clampedY = Math.max(0, Math.min(Math.round(y), SVG_DIMENSIONS.height));
    const formattedX = clampedX.toString().padStart(3, '0');
    const formattedY = clampedY.toString().padStart(3, '0');
    node.textContent = `X: ${formattedX}, Y: ${formattedY}`;
    this._debugCoordsActive = true;
  }

  _attachEventListeners() {
    if (!this.shadowRoot || !this._domRefs) return;

    // Remove existing listeners to avoid duplicates
    if (this._eventListenerAttached) {
      // Remove old listeners before re-attaching by cloning nodes
      const cloneAndReplace = (element, refName) => {
        if (element && element.parentNode) {
          const newElement = element.cloneNode(true);
          element.parentNode.replaceChild(newElement, element);
          this._domRefs[refName] = newElement;
        }
      };
      cloneAndReplace(this._domRefs.houseClickableArea, 'houseClickableArea');
      cloneAndReplace(this._domRefs.pvClickableArea, 'pvClickableArea');
      cloneAndReplace(this._domRefs.batteryClickableArea, 'batteryClickableArea');
      cloneAndReplace(this._domRefs.gridClickableArea, 'gridClickableArea');
      cloneAndReplace(this._domRefs.inverterClickableArea, 'inverterClickableArea');
    }
    this._eventListenerAttached = true;

    // Attach click listener to house clickable area for house popup
    if (this._domRefs.houseClickableArea) {
      this._domRefs.houseClickableArea.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Set flag to prevent outside click handler from closing popup
        this._clickingClickableArea = true;
        setTimeout(() => {
          this._clickingClickableArea = false;
        }, 100);
        this._toggleHousePopup();
      }, true); // Use capture phase to catch before outside handler
    }

    // Attach click listener to PV clickable area for PV popup
    if (this._domRefs.pvClickableArea) {
      // Ensure pointer-events is set correctly
      if (this._domRefs.pvClickableArea.style.pointerEvents !== 'all' && this._domRefs.pvClickableArea.style.pointerEvents !== 'auto') {
        this._domRefs.pvClickableArea.style.pointerEvents = 'all';
      }
      // Ensure display is set correctly based on pvUiEnabled
      const pvUiEnabled = this._pvUiEnabled !== false; // Default to true if not explicitly false
      const correctDisplay = pvUiEnabled ? 'inline' : 'none';
      if (this._domRefs.pvClickableArea.style.display !== correctDisplay) {
        this._domRefs.pvClickableArea.style.display = correctDisplay;
      }
      this._domRefs.pvClickableArea.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Set flag to prevent outside click handler from closing popup
        this._clickingClickableArea = true;
        setTimeout(() => {
          this._clickingClickableArea = false;
        }, 100);
        this._togglePvPopup();
      }, true); // Use capture phase to catch before outside handler
    } else {
    }

    // Attach click listeners to toggle switches
    const attachToggleListeners = (toggles, popupType) => {
      if (!toggles || !Array.isArray(toggles)) {
        return;
      }
      toggles.forEach((toggle, index) => {
        if (toggle) {
          // Add listener to the toggle group itself
          toggle.addEventListener('click', async (event) => {
            event.stopPropagation();
            event.preventDefault();
            const entityId = toggle.getAttribute('data-entity-id');
            if (entityId) {
              // Get current state before toggle
              const entity = this._hass && this._hass.states && this._hass.states[entityId];
              const currentState = entity ? (entity.state || '').toLowerCase() : '';
              const wasOn = currentState === 'on' || currentState === 'open' || currentState === 'unlocked';
              // Optimistically update toggle immediately for better UX
              this._updateToggleSwitchOptimistic(toggle, !wasOn);
              
              await this._toggleEntity(entityId);
              // Toggle state is updated immediately via _updateAllToggleSwitches()
            }
          });
          // Also add listeners to child elements (rect, circle) to prevent propagation
          const rect = toggle.querySelector('rect');
          const circle = toggle.querySelector('circle');
          if (rect) {
            rect.addEventListener('click', (e) => {
              e.stopPropagation();
              e.preventDefault();
              toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            });
          }
          if (circle) {
            circle.addEventListener('click', (e) => {
              e.stopPropagation();
              e.preventDefault();
              toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            });
          }
        }
      });
    };

    attachToggleListeners(this._domRefs.pvPopupToggles, 'pv');
    attachToggleListeners(this._domRefs.batteryPopupToggles, 'battery');
    attachToggleListeners(this._domRefs.housePopupToggles, 'house');
    attachToggleListeners(this._domRefs.gridPopupToggles, 'grid');
    attachToggleListeners(this._domRefs.inverterPopupToggles, 'inverter');

    // Prevent clicks on popup content (text, groups) from closing the popup
    const attachPopupContentListeners = (popupRef) => {
      if (!popupRef) return;
      // Add click listeners to all text elements and line groups to stop propagation
      const textElements = popupRef.querySelectorAll('text');
      const lineGroups = popupRef.querySelectorAll('[data-role*="-popup-line-"][data-role*="-group"]');
      const toggleGroups = popupRef.querySelectorAll('[data-role*="-popup-toggle"]');
      const allContentElements = [...Array.from(textElements), ...Array.from(lineGroups), ...Array.from(toggleGroups)];
      allContentElements.forEach(element => {
        if (element) {
          element.addEventListener('click', (e) => {
            e.stopPropagation();
          });
          // Also set pointer-events to ensure clicks are captured
          element.style.pointerEvents = 'auto';
        }
      });
    };
    
    attachPopupContentListeners(this._domRefs.pvPopup);
    attachPopupContentListeners(this._domRefs.batteryPopup);
    attachPopupContentListeners(this._domRefs.housePopup);
    attachPopupContentListeners(this._domRefs.gridPopup);
    attachPopupContentListeners(this._domRefs.inverterPopup);

    // Attach click listener to battery clickable area for battery popup
    if (this._domRefs.batteryClickableArea) {
      this._domRefs.batteryClickableArea.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Set flag to prevent outside click handler from closing popup
        this._clickingClickableArea = true;
        setTimeout(() => {
          this._clickingClickableArea = false;
        }, 100);
        this._toggleBatteryPopup();
      }, true); // Use capture phase to catch before outside handler
    }

    // Attach click listener to grid clickable area for grid popup
    if (this._domRefs.gridClickableArea) {
      this._domRefs.gridClickableArea.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Set flag to prevent outside click handler from closing popup
        this._clickingClickableArea = true;
        setTimeout(() => {
          this._clickingClickableArea = false;
        }, 100);
        this._toggleGridPopup();
      }, true); // Use capture phase to catch before outside handler
    }

    // Attach click listener to inverter clickable area for inverter popup
    if (this._domRefs.inverterClickableArea) {
      this._domRefs.inverterClickableArea.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Set flag to prevent outside click handler from closing popup
        this._clickingClickableArea = true;
        setTimeout(() => {
          this._clickingClickableArea = false;
        }, 100);
        this._toggleInverterPopup();
      }, true); // Use capture phase to catch before outside handler
    }

    // Attach click listener to close popups when clicking outside
    // Popups should stay open until user clicks outside or clicks the clickable area again
    const attachPopupOutsideClickClose = (popupRef, hideFn, popupType) => {
      if (!popupRef) {
        return;
      }
      // Store the hide function for this popup type
      if (!this._popupHideFunctions) {
        this._popupHideFunctions = {};
      }
      this._popupHideFunctions[popupType] = hideFn;
      
      // Prevent clicks inside popup from closing it
      popupRef.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    };
    
    attachPopupOutsideClickClose(this._domRefs.pvPopup, () => this._hidePvPopup(), 'pv');
    attachPopupOutsideClickClose(this._domRefs.batteryPopup, () => this._hideBatteryPopup(), 'battery');
    attachPopupOutsideClickClose(this._domRefs.housePopup, () => this._hideHousePopup(), 'house');
    attachPopupOutsideClickClose(this._domRefs.gridPopup, () => this._hideGridPopup(), 'grid');
    attachPopupOutsideClickClose(this._domRefs.inverterPopup, () => this._hideInverterPopup(), 'inverter');
    
    // Add document-level click listener to close popups when clicking outside
    // Remove previous listener if it exists to avoid duplicates
    if (this._popupOutsideClickHandler) {
      document.removeEventListener('click', this._popupOutsideClickHandler, true);
    }
    
      this._popupOutsideClickHandler = (e) => {
        
        // Don't close if we're currently clicking on a clickable area
        if (this._clickingClickableArea) {
          return;
        }
        
        // Don't close if popup was just opened (within 300ms)
        if (this._popupJustOpened) {
          return;
        }
        
        // Check if click is on a clickable area (which will toggle the popup) - check this FIRST
        // Use composedPath to check the entire event path, not just e.target
        const path = e.composedPath ? e.composedPath() : [];
        const clickedPvArea = path.find(el => el && el.getAttribute && el.getAttribute('data-role') === 'pv-clickable-area');
        const clickedBatteryArea = path.find(el => el && el.getAttribute && el.getAttribute('data-role') === 'battery-clickable-area');
        const clickedHouseArea = path.find(el => el && el.getAttribute && el.getAttribute('data-role') === 'house-clickable-area');
        const clickedGridArea = path.find(el => el && el.getAttribute && el.getAttribute('data-role') === 'grid-clickable-area');
        const clickedInverterArea = path.find(el => el && el.getAttribute && el.getAttribute('data-role') === 'inverter-clickable-area');
        if (clickedPvArea || clickedBatteryArea || clickedHouseArea || clickedGridArea || clickedInverterArea) {
          return; // Click is on a clickable area, let it handle the toggle
        }
        
        // Check if click is inside shadow root or inside a popup
        const shadowRoot = this.shadowRoot;
        const isInsideShadowRoot = shadowRoot && shadowRoot.contains(e.target);
        const clickedPopup = path.find(el => el && el.getAttribute && el.getAttribute('data-role') && el.getAttribute('data-role').includes('-popup'));
        if (clickedPopup) {
          return; // Click is inside a popup, don't close
        }
        
        if (isInsideShadowRoot) {
          // Click is inside shadow root but not on popup or clickable area, close popups
          if (this._popupHideFunctions) {
            Object.values(this._popupHideFunctions).forEach((hideFn, idx) => {
              if (typeof hideFn === 'function') {
                hideFn();
              }
            });
          }
        } else {
          // Click is outside shadow root - check if any popup is actually visible before closing
          const hasVisiblePopup = this._domRefs && (
            (this._domRefs.pvPopup && this._domRefs.pvPopup.style.display !== 'none') ||
            (this._domRefs.batteryPopup && this._domRefs.batteryPopup.style.display !== 'none') ||
            (this._domRefs.housePopup && this._domRefs.housePopup.style.display !== 'none') ||
            (this._domRefs.gridPopup && this._domRefs.gridPopup.style.display !== 'none') ||
            (this._domRefs.inverterPopup && this._domRefs.inverterPopup.style.display !== 'none')
          );
          if (hasVisiblePopup) {
            if (this._popupHideFunctions) {
              Object.values(this._popupHideFunctions).forEach((hideFn, idx) => {
                if (typeof hideFn === 'function') {
                  hideFn();
                }
              });
            }
          } else {
          }
        }
      };
      
      // Use capture phase to catch clicks before they bubble
      document.addEventListener('click', this._popupOutsideClickHandler, true);
    if (DEBUG_GRID_ENABLED && this._domRefs.svgRoot) {
      this._domRefs.svgRoot.addEventListener('pointermove', this._handleDebugPointerMove);
      this._domRefs.svgRoot.addEventListener('pointerleave', this._handleDebugPointerLeave);
      
      // Aggiungi listener ai testi per il drag
      const textElements = this._domRefs.svgRoot.querySelectorAll('[data-role*="pv-line"], [data-role*="battery"], [data-role*="load"], [data-role*="house-temp"], [data-role*="heat-pump"], [data-role*="grid"], [data-role*="car"]');
      textElements.forEach(textEl => {
        if (textEl.tagName === 'text') {
          textEl.style.cursor = 'grab';
          textEl.addEventListener('mousedown', this._handleTextMouseDown);
        }
      });
      
      document.addEventListener('mousemove', this._handleDocumentMouseMove, true);
      document.addEventListener('mouseup', this._handleDocumentMouseUp, true);
    }

    // Attach click listener to echo alive container
    if (this._domRefs.echoAliveContainer) {
      this._domRefs.echoAliveContainer.addEventListener('click', this._handleEchoAliveClickBound, true);
    }

    if (this._domRefs.activeTextButton) {
      this._domRefs.activeTextButton.addEventListener('click', this._handleTextToggleClickBound, true);
    }
    if (this._domRefs.homeButton) {
      this._domRefs.homeButton.addEventListener('click', this._handleHomeButtonClickBound, true);
    }
    if (this._domRefs.homeCollapsiblePanel) {
      this._domRefs.homeCollapsiblePanel.addEventListener('click', this._handleHouseIconClickBound, true);
    }
  }

  _handleTextToggleClick(event) {
    try {
      if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
      // Cycle through 3 states: 0 (all visible) → 1 (grid/pv boxes and lines hidden) → 2 (all text hidden) → 0
      this._textsVisible = (this._textsVisible + 1) % 3;
      this._updateTextVisibility();
    } catch (e) {
      // ignore
    }
  }

  _handleHomeButtonClick(event) {
    try {
      if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
      this._homePanelExpanded = !this._homePanelExpanded;
      const panel = this._domRefs && this._domRefs.homeCollapsiblePanel;
      if (panel) {
        panel.classList.toggle('home-collapsible-panel--expanded', this._homePanelExpanded);
      }
    } catch (e) {
      // ignore
    }
  }

  _handleHouseIconClick(event) {
    try {
      const btn = event && event.target && event.target.closest && event.target.closest('[data-home-icon]');
      if (!btn || !btn.dataset || !btn.dataset.homeIcon) return;
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      this._openHouseIconPopup(btn.dataset.homeIcon);
    } catch (e) {
      // ignore
    }
  }

  _getHousePopupTranslations() {
    // Language: config.language, else hass.locale (e.g. it-IT -> it), else en
    const config = { ...(this._defaults || {}), ...(this.config || {}) };
    let lang = config.language;
    if (!lang && this._hass && this._hass.locale) {
      const locale = this._hass.locale;
      const dashIdx = locale.indexOf('-');
      lang = dashIdx > 0 ? locale.substring(0, dashIdx) : locale;
    }
    lang = (lang || 'en').toLowerCase();
    
    const translations = {
      en: {
        cameras: 'Cameras',
        lights: 'Lights',
        temperature: 'Temperature',
        humidity: 'Humidity',
        start: '▶ Start',
        stop: '■ Stop',
        on: 'On',
        off: 'Off',
        onBtn: 'ON',
        offBtn: 'OFF'
      },
      it: {
        cameras: 'Telecamere',
        lights: 'Luci',
        temperature: 'Temperatura',
        humidity: 'Umidità',
        start: '▶ Avvia',
        stop: '■ Stop',
        on: 'Acceso',
        off: 'Spento',
        onBtn: 'ON',
        offBtn: 'OFF'
      },
      de: {
        cameras: 'Kameras',
        lights: 'Lichter',
        temperature: 'Temperatur',
        humidity: 'Luftfeuchtigkeit',
        start: '▶ Start',
        stop: '■ Stop',
        on: 'Ein',
        off: 'Aus',
        onBtn: 'EIN',
        offBtn: 'AUS'
      },
      fr: {
        cameras: 'Caméras',
        lights: 'Lumières',
        temperature: 'Température',
        humidity: 'Humidité',
        start: '▶ Démarrer',
        stop: '■ Arrêter',
        on: 'Allumé',
        off: 'Éteint',
        onBtn: 'ON',
        offBtn: 'OFF'
      },
      nl: {
        cameras: 'Camera\'s',
        lights: 'Lichten',
        temperature: 'Temperatuur',
        humidity: 'Luchtvochtigheid',
        start: '▶ Start',
        stop: '■ Stop',
        on: 'Aan',
        off: 'Uit',
        onBtn: 'AAN',
        offBtn: 'UIT'
      }
    };
    
    return translations[lang] || translations.en;
  }

  _openHouseIconPopup(iconKey) {
    this._closeHouseIconPopup();
    const config = { ...(this._defaults || {}), ...(this.config || {}) };
    const cfg = (k) => (config[k] != null && String(config[k]).trim()) ? String(config[k]).trim() : '';
    const t = this._getHousePopupTranslations();
    if (iconKey === 'camera') {
      const entityIds = [1, 2, 3, 4, 5, 6].map(i => cfg(`house_camera_${i}`)).filter(Boolean);
      if (entityIds.length === 0) return;
      let base = (this._hass && typeof this._hass.hassUrl === 'function') ? this._hass.hassUrl() : (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
      if (base && base.endsWith('/')) base = base.slice(0, -1);
      const useLiveStreamForEntity = (eid) => {
        if (typeof customElements === 'undefined' || !customElements.get('ha-camera-stream')) return false;
        const ent = this._hass && this._hass.states && this._hass.states[eid];
        return !!(ent && ent.attributes && (ent.attributes.access_token != null && ent.attributes.access_token !== ''));
      };
      const getAuthenticatedUrl = (eid) => {
        const ent = this._hass && this._hass.states && this._hass.states[eid];
        const token = ent && ent.attributes && ent.attributes.access_token;
        const attr = ent && ent.attributes && ent.attributes.entity_picture;
        if (token) {
          const q = '?token=' + encodeURIComponent(token) + '&t=' + Date.now();
          return base + '/api/camera_proxy/' + eid + q;
        }
        if (attr && typeof attr === 'string' && attr.trim()) {
          const path = attr.startsWith('/') ? attr : '/' + attr;
          const sep = path.includes('?') ? '&' : '?';
          return base + path + sep + 't=' + Date.now();
        }
        return base + '/api/camera_proxy_stream/' + eid + '?t=' + Date.now();
      };
      const getCameraName = (eid) => {
        const ent = this._hass && this._hass.states && this._hass.states[eid];
        const fn = ent && ent.attributes && ent.attributes.friendly_name;
        return (fn && typeof fn === 'string' && fn.trim()) ? fn.trim() : eid;
      };
      const overlay = document.createElement('div');
      overlay.className = 'lumina-house-popup-overlay';
      overlay.setAttribute('data-role', 'house-icon-popup-overlay');
      const popupStyle = document.createElement('style');
      popupStyle.textContent = `
        .lumina-house-popup-overlay { position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:99999;display:flex;align-items:center;justify-content:center;padding:clamp(8px,2vmin,16px);box-sizing:border-box;overflow:auto;-webkit-overflow-scrolling:touch; }
        .lumina-house-popup-panel { position:relative;width:100%;max-width:min(96vw,1200px);height:max-content;min-height:40vh;max-height:96vh;overflow:auto;background:#001428;border:2px solid #00FFFF;border-radius:clamp(8px,2vmin,12px);padding:clamp(12px,3vmin,24px);box-shadow:0 0 24px rgba(0,255,255,0.3);box-sizing:border-box; }
        .lumina-house-popup-title { color:#00FFFF;font-family:Orbitron,sans-serif;font-size:clamp(14px,3vmin,18px);margin-bottom:clamp(10px,2vmin,16px);padding-right:clamp(44px,10vmin,52px); }
        .lumina-house-popup-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:clamp(8px,2vmin,16px); }
        .lumina-camera-cell { display:flex;flex-direction:column;background:#0a1628;border:1px solid #00FFFF;border-radius:8px;overflow:hidden; }
        .lumina-camera-video-wrap { position:relative;aspect-ratio:16/9;min-height:clamp(100px,25vmin,200px);background:#0a1628;overflow:hidden; }
        .lumina-camera-name { color:#00FFFF;font-family:Orbitron,sans-serif;font-size:clamp(11px,2.5vmin,15px);padding:clamp(6px,1.5vmin,10px) 12px;border-top:1px solid rgba(0,255,255,0.3);word-break:break-word; }
        .lumina-camera-btns { display:flex;gap:clamp(6px,1.5vmin,10px);padding:clamp(6px,1.5vmin,10px) 12px;border-top:1px solid rgba(0,255,255,0.2); }
        .lumina-camera-btn { font-family:Orbitron,sans-serif;color:#00FFFF;border:2px solid #00FFFF;background:rgba(0,20,40,0.95);border-radius:8px;cursor:pointer;padding:clamp(6px,1.5vmin,10px) clamp(12px,2.5vmin,18px);font-size:clamp(11px,2.5vmin,15px);font-weight:bold;flex:1;min-width:0;touch-action:manipulation; }
        .lumina-camera-btn:hover { background:rgba(0,255,255,0.15); }
        .lumina-house-popup-close { position:absolute;top:clamp(8px,2vmin,12px);right:clamp(8px,2vmin,12px);width:clamp(32px,8vmin,40px);height:clamp(32px,8vmin,40px);border-radius:50%;border:2px solid #00FFFF;background:rgba(0,20,40,0.9);color:#00FFFF;font-size:clamp(18px,4vmin,24px);line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;z-index:2;touch-action:manipulation; }
        .lumina-house-popup-close:hover { background:rgba(0,255,255,0.2); }
        .lumina-house-popup-list { display:flex;flex-direction:column;gap:clamp(6px,1.5vmin,10px); }
        .lumina-house-popup-list-row { display:flex;align-items:center;gap:12px;padding:clamp(8px,2vmin,12px);background:#0a1628;border:1px solid #00FFFF;border-radius:8px; }
        .lumina-house-popup-list-name { color:#00FFFF;font-family:Orbitron,sans-serif;font-size:clamp(12px,2.5vmin,16px);flex:1;min-width:0;word-break:break-word; }
        .lumina-house-popup-list-value { color:rgba(0,255,255,0.9);font-family:Orbitron,sans-serif;font-size:clamp(12px,2.5vmin,16px); }
        .lumina-house-popup-list-btns { display:flex;gap:8px;flex-shrink:0; }
        @media (max-width:480px) { .lumina-house-popup-grid { grid-template-columns:1fr; } }
      `;
      overlay.appendChild(popupStyle);
      const panel = document.createElement('div');
      panel.className = 'lumina-house-popup-panel';
      overlay.appendChild(panel);
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'lumina-house-popup-close';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => this._closeHouseIconPopup());
      panel.appendChild(closeBtn);
      const title = document.createElement('div');
      title.className = 'lumina-house-popup-title';
      title.textContent = t.cameras;
      panel.appendChild(title);
      const grid = document.createElement('div');
      grid.className = 'lumina-house-popup-grid';
      panel.appendChild(grid);

      entityIds.forEach((eid) => {
        const wrap = document.createElement('div');
        wrap.setAttribute('data-lumina-camera-cell', '1');
        wrap.className = 'lumina-camera-cell';
        const videoWrap = document.createElement('div');
        videoWrap.className = 'lumina-camera-video-wrap';
        const nameEl = document.createElement('div');
        nameEl.className = 'lumina-camera-name';
        nameEl.textContent = getCameraName(eid);
        const btnRow = document.createElement('div');
        btnRow.className = 'lumina-camera-btns';
        const startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.className = 'lumina-camera-btn';
        startBtn.textContent = t.start;
        const stopBtn = document.createElement('button');
        stopBtn.type = 'button';
        stopBtn.className = 'lumina-camera-btn';
        stopBtn.textContent = t.stop;
        stopBtn.style.display = 'none';

        const stopStream = () => {
          if (wrap._luminaRefresh) {
            clearInterval(wrap._luminaRefresh);
            wrap._luminaRefresh = null;
          }
          const streamEl = wrap._luminaStreamEl;
          if (streamEl && streamEl.parentNode) streamEl.parentNode.removeChild(streamEl);
          wrap._luminaStreamEl = null;
          startBtn.style.display = '';
          stopBtn.style.display = 'none';
        };

        startBtn.addEventListener('click', () => {
          startBtn.style.display = 'none';
          stopBtn.style.display = '';
          if (useLiveStreamForEntity(eid)) {
            const stream = document.createElement('ha-camera-stream');
            stream.setAttribute('muted', '');
            stream.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;';
            const stateObj = this._hass && this._hass.states && this._hass.states[eid];
            if (stateObj) {
              stream.hass = this._hass;
              stream.stateObj = stateObj;
              stream.fitMode = 'contain';
              stream.aspectRatio = 16 / 9;
            }
            videoWrap.appendChild(stream);
            wrap._luminaStreamEl = stream;
          } else {
            const img = document.createElement('img');
            img.alt = eid;
            img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
            img.loading = 'eager';
            img.src = getAuthenticatedUrl(eid);
            videoWrap.appendChild(img);
            wrap._luminaStreamEl = img;
            wrap._luminaRefresh = setInterval(() => {
              if (!wrap.parentNode || !this._houseIconPopupOverlay) return;
              img.src = getAuthenticatedUrl(eid);
            }, 1500);
          }
        });

        stopBtn.addEventListener('click', stopStream);

        btnRow.appendChild(startBtn);
        btnRow.appendChild(stopBtn);
        wrap.appendChild(videoWrap);
        wrap.appendChild(nameEl);
        wrap.appendChild(btnRow);
        grid.appendChild(wrap);
      });

      overlay.addEventListener('click', (e) => { if (e.target === overlay) this._closeHouseIconPopup(); });
      const root = typeof document !== 'undefined' && document.body ? document.body : (this.shadowRoot || this);
      root.appendChild(overlay);
      this._houseIconPopupOverlay = overlay;
      return;
    }

    if (iconKey === 'lights') {
      const entityIds = [1, 2, 3, 4, 5, 6].map(i => cfg(`house_lights_${i}`)).filter(Boolean);
      if (entityIds.length === 0) return;
      const overlay = document.createElement('div');
      overlay.className = 'lumina-house-popup-overlay';
      overlay.setAttribute('data-role', 'house-icon-popup-overlay');
      const popupStyle = document.createElement('style');
      popupStyle.textContent = `
        .lumina-house-popup-overlay { position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:99999;display:flex;align-items:center;justify-content:center;padding:clamp(8px,2vmin,16px);box-sizing:border-box;overflow:auto;-webkit-overflow-scrolling:touch; }
        .lumina-house-popup-panel { position:relative;width:100%;max-width:min(96vw,1200px);height:max-content;min-height:40vh;max-height:96vh;overflow:auto;background:#001428;border:2px solid #00FFFF;border-radius:clamp(8px,2vmin,12px);padding:clamp(12px,3vmin,24px);box-shadow:0 0 24px rgba(0,255,255,0.3);box-sizing:border-box; }
        .lumina-house-popup-title { color:#00FFFF;font-family:Orbitron,sans-serif;font-size:clamp(14px,3vmin,18px);margin-bottom:clamp(10px,2vmin,16px);padding-right:clamp(44px,10vmin,52px); }
        .lumina-house-popup-list { display:flex;flex-direction:column;gap:clamp(6px,1.5vmin,10px); }
        .lumina-house-popup-list-row { display:flex;align-items:center;gap:12px;padding:clamp(8px,2vmin,12px);background:#0a1628;border:1px solid #00FFFF;border-radius:8px; }
        .lumina-house-popup-list-name { color:#00FFFF;font-family:Orbitron,sans-serif;font-size:clamp(12px,2.5vmin,16px);flex:1;min-width:0;word-break:break-word; }
        .lumina-house-popup-list-value { color:rgba(0,255,255,0.9);font-family:Orbitron,sans-serif;font-size:clamp(12px,2.5vmin,16px); }
        .lumina-house-popup-list-btns { display:flex;gap:8px;flex-shrink:0; }
        .lumina-house-popup-close { position:absolute;top:clamp(8px,2vmin,12px);right:clamp(8px,2vmin,12px);width:clamp(32px,8vmin,40px);height:clamp(32px,8vmin,40px);border-radius:50%;border:2px solid #00FFFF;background:rgba(0,20,40,0.9);color:#00FFFF;font-size:clamp(18px,4vmin,24px);line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;z-index:2;touch-action:manipulation; }
        .lumina-house-popup-close:hover { background:rgba(0,255,255,0.2); }
        .lumina-camera-btn { font-family:Orbitron,sans-serif;color:#00FFFF;border:2px solid #00FFFF;background:rgba(0,20,40,0.95);border-radius:8px;cursor:pointer;padding:clamp(6px,1.5vmin,10px) clamp(12px,2.5vmin,18px);font-size:clamp(11px,2.5vmin,15px);font-weight:bold;touch-action:manipulation; }
        .lumina-camera-btn:hover { background:rgba(0,255,255,0.15); }
      `;
      overlay.appendChild(popupStyle);
      const panel = document.createElement('div');
      panel.className = 'lumina-house-popup-panel';
      overlay.appendChild(panel);
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'lumina-house-popup-close';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => this._closeHouseIconPopup());
      panel.appendChild(closeBtn);
      const title = document.createElement('div');
      title.className = 'lumina-house-popup-title';
      title.textContent = t.lights;
      panel.appendChild(title);
      const list = document.createElement('div');
      list.className = 'lumina-house-popup-list';
      panel.appendChild(list);
      const getEntityName = (eid) => {
        const ent = this._hass && this._hass.states && this._hass.states[eid];
        const fn = ent && ent.attributes && ent.attributes.friendly_name;
        return (fn && typeof fn === 'string' && fn.trim()) ? fn.trim() : eid;
      };
      entityIds.forEach((eid) => {
        const row = document.createElement('div');
        row.className = 'lumina-house-popup-list-row';
        const nameEl = document.createElement('div');
        nameEl.className = 'lumina-house-popup-list-name';
        nameEl.textContent = getEntityName(eid);
        const valueEl = document.createElement('div');
        valueEl.className = 'lumina-house-popup-list-value';
        const updateState = () => {
          const s = this._hass && this._hass.states && this._hass.states[eid];
          valueEl.textContent = (s && s.state && String(s.state).toLowerCase() === 'on') ? t.on : t.off;
        };
        updateState();
        const domain = (this._hass && this._hass.states && this._hass.states[eid]) ? (this._hass.states[eid].entity_id || '').split('.')[0] : '';
        const dom = domain === 'light' || domain === 'switch' ? domain : null;
        const onBtn = document.createElement('button');
        onBtn.type = 'button';
        onBtn.className = 'lumina-camera-btn';
        onBtn.textContent = t.onBtn;
        onBtn.addEventListener('click', async () => {
          if (!this._hass || !this._hass.callService || !dom) return;
          try { await this._hass.callService(dom, 'turn_on', { entity_id: eid }); } catch (e) {}
          setTimeout(updateState, 400);
        });
        const offBtn = document.createElement('button');
        offBtn.type = 'button';
        offBtn.className = 'lumina-camera-btn';
        offBtn.textContent = t.offBtn;
        offBtn.addEventListener('click', async () => {
          if (!this._hass || !this._hass.callService || !dom) return;
          try { await this._hass.callService(dom, 'turn_off', { entity_id: eid }); } catch (e) {}
          setTimeout(updateState, 400);
        });
        if (!dom) {
          onBtn.style.display = 'none';
          offBtn.style.display = 'none';
        }
        const btns = document.createElement('div');
        btns.className = 'lumina-house-popup-list-btns';
        btns.appendChild(onBtn);
        btns.appendChild(offBtn);
        row.appendChild(nameEl);
        row.appendChild(valueEl);
        row.appendChild(btns);
        list.appendChild(row);
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) this._closeHouseIconPopup(); });
      const root = typeof document !== 'undefined' && document.body ? document.body : (this.shadowRoot || this);
      root.appendChild(overlay);
      this._houseIconPopupOverlay = overlay;
      return;
    }

    if (iconKey === 'temperature') {
      const entityIds = [1, 2, 3, 4, 5, 6].map(i => cfg(`house_temperature_${i}`)).filter(Boolean);
      if (entityIds.length === 0) return;
      const overlay = document.createElement('div');
      overlay.className = 'lumina-house-popup-overlay';
      overlay.setAttribute('data-role', 'house-icon-popup-overlay');
      const popupStyle = document.createElement('style');
      popupStyle.textContent = `
        .lumina-house-popup-overlay { position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:99999;display:flex;align-items:center;justify-content:center;padding:clamp(8px,2vmin,16px);box-sizing:border-box;overflow:auto;-webkit-overflow-scrolling:touch; }
        .lumina-house-popup-panel { position:relative;width:100%;max-width:min(96vw,1200px);height:max-content;min-height:40vh;max-height:96vh;overflow:auto;background:#001428;border:2px solid #00FFFF;border-radius:clamp(8px,2vmin,12px);padding:clamp(12px,3vmin,24px);box-shadow:0 0 24px rgba(0,255,255,0.3);box-sizing:border-box; }
        .lumina-house-popup-title { color:#00FFFF;font-family:Orbitron,sans-serif;font-size:clamp(14px,3vmin,18px);margin-bottom:clamp(10px,2vmin,16px);padding-right:clamp(44px,10vmin,52px); }
        .lumina-house-popup-list { display:flex;flex-direction:column;gap:clamp(6px,1.5vmin,10px); }
        .lumina-house-popup-list-row { display:flex;align-items:center;gap:12px;padding:clamp(8px,2vmin,12px);background:#0a1628;border:1px solid #00FFFF;border-radius:8px; }
        .lumina-house-popup-list-name { color:#00FFFF;font-family:Orbitron,sans-serif;font-size:clamp(12px,2.5vmin,16px);flex:1;min-width:0;word-break:break-word; }
        .lumina-house-popup-list-value { color:rgba(0,255,255,0.9);font-family:Orbitron,sans-serif;font-size:clamp(12px,2.5vmin,16px); }
        .lumina-house-popup-close { position:absolute;top:clamp(8px,2vmin,12px);right:clamp(8px,2vmin,12px);width:clamp(32px,8vmin,40px);height:clamp(32px,8vmin,40px);border-radius:50%;border:2px solid #00FFFF;background:rgba(0,20,40,0.9);color:#00FFFF;font-size:clamp(18px,4vmin,24px);line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;z-index:2;touch-action:manipulation; }
        .lumina-house-popup-close:hover { background:rgba(0,255,255,0.2); }
        .lumina-thermostat-card { display:flex;flex-direction:column;gap:8px;background:#0a1628;border:1px solid #00FFFF;border-radius:8px;padding:12px; }
        .lumina-thermostat-header { display:flex;justify-content:space-between;align-items:center;margin-bottom:8px; }
        .lumina-thermostat-name { color:#00FFFF;font-family:Orbitron,sans-serif;font-size:clamp(12px,2.5vmin,16px);font-weight:bold; }
        .lumina-thermostat-temps { display:flex;gap:16px;align-items:center;justify-content:center;margin:8px 0; }
        .lumina-thermostat-temp-group { display:flex;flex-direction:column;align-items:center; }
        .lumina-thermostat-temp-label { color:rgba(0,255,255,0.7);font-family:Orbitron,sans-serif;font-size:10px;margin-bottom:4px; }
        .lumina-thermostat-temp-value { color:#00FFFF;font-family:Orbitron,sans-serif;font-size:clamp(16px,4vmin,24px);font-weight:bold; }
        .lumina-thermostat-controls { display:flex;gap:8px;align-items:center;justify-content:center;margin:8px 0; }
        .lumina-thermostat-btn { width:36px;height:36px;border-radius:50%;border:2px solid #00FFFF;background:rgba(0,20,40,0.9);color:#00FFFF;font-size:20px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s;touch-action:manipulation; }
        .lumina-thermostat-btn:hover { background:rgba(0,255,255,0.2);transform:scale(1.1); }
        .lumina-thermostat-btn:active { transform:scale(0.95); }
        .lumina-thermostat-slider { flex:1;max-width:200px;height:6px;border-radius:3px;background:rgba(0,255,255,0.2);position:relative;cursor:pointer; }
        .lumina-thermostat-slider-fill { height:100%;background:#00FFFF;border-radius:3px;transition:width 0.2s; }
        .lumina-thermostat-slider-thumb { width:20px;height:20px;border-radius:50%;background:#00FFFF;border:2px solid #001428;position:absolute;top:50%;transform:translate(-50%,-50%);cursor:grab;box-shadow:0 0 8px rgba(0,255,255,0.5); }
        .lumina-thermostat-slider-thumb:active { cursor:grabbing; }
        .lumina-thermostat-modes { display:flex;gap:6px;justify-content:center;flex-wrap:wrap; }
        .lumina-thermostat-mode-btn { padding:6px 12px;border-radius:6px;border:1px solid #00FFFF;background:rgba(0,20,40,0.9);color:rgba(0,255,255,0.7);font-family:Orbitron,sans-serif;font-size:11px;cursor:pointer;transition:all 0.2s;touch-action:manipulation; }
        .lumina-thermostat-mode-btn.active { background:rgba(0,255,255,0.3);color:#00FFFF;font-weight:bold; }
        .lumina-thermostat-mode-btn:hover { background:rgba(0,255,255,0.2); }
      `;
      overlay.appendChild(popupStyle);
      const panel = document.createElement('div');
      panel.className = 'lumina-house-popup-panel';
      overlay.appendChild(panel);
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'lumina-house-popup-close';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => this._closeHouseIconPopup());
      panel.appendChild(closeBtn);
      const title = document.createElement('div');
      title.className = 'lumina-house-popup-title';
      title.textContent = t.temperature;
      panel.appendChild(title);
      const list = document.createElement('div');
      list.className = 'lumina-house-popup-list';
      panel.appendChild(list);
      const getEntityName = (eid) => {
        const ent = this._hass && this._hass.states && this._hass.states[eid];
        const fn = ent && ent.attributes && ent.attributes.friendly_name;
        return (fn && typeof fn === 'string' && fn.trim()) ? fn.trim() : eid;
      };
      
      // Helper function to create thermostat controls
      const createThermostatCard = (eid) => {
        const card = document.createElement('div');
        card.className = 'lumina-thermostat-card';
        const s = this._hass && this._hass.states && this._hass.states[eid];
        if (!s) return null;
        
        const attrs = s.attributes || {};
        const currentTemp = attrs.current_temperature;
        const targetTemp = attrs.temperature;
        const hvacMode = s.state;
        const hvacModes = attrs.hvac_modes || [];
        const minTemp = attrs.min_temp || 7;
        const maxTemp = attrs.max_temp || 35;
        const tempStep = attrs.target_temp_step || 0.5;
        const unit = attrs.unit_of_measurement || '°C';
        
        // Header with name
        const header = document.createElement('div');
        header.className = 'lumina-thermostat-header';
        const nameEl = document.createElement('div');
        nameEl.className = 'lumina-thermostat-name';
        nameEl.textContent = getEntityName(eid);
        header.appendChild(nameEl);
        card.appendChild(header);
        
        // Temperature display
        const temps = document.createElement('div');
        temps.className = 'lumina-thermostat-temps';
        
        if (currentTemp != null) {
          const currentGroup = document.createElement('div');
          currentGroup.className = 'lumina-thermostat-temp-group';
          const currentLabel = document.createElement('div');
          currentLabel.className = 'lumina-thermostat-temp-label';
          currentLabel.textContent = 'CURRENT';
          const currentValue = document.createElement('div');
          currentValue.className = 'lumina-thermostat-temp-value';
          currentValue.textContent = `${Number(currentTemp).toFixed(1)}${unit}`;
          currentGroup.appendChild(currentLabel);
          currentGroup.appendChild(currentValue);
          temps.appendChild(currentGroup);
        }
        
        if (targetTemp != null && hvacMode !== 'off') {
          const targetGroup = document.createElement('div');
          targetGroup.className = 'lumina-thermostat-temp-group';
          const targetLabel = document.createElement('div');
          targetLabel.className = 'lumina-thermostat-temp-label';
          targetLabel.textContent = 'TARGET';
          const targetValue = document.createElement('div');
          targetValue.className = 'lumina-thermostat-temp-value';
          targetValue.textContent = `${Number(targetTemp).toFixed(1)}${unit}`;
          targetValue.setAttribute('data-target-temp', 'true');
          targetGroup.appendChild(targetLabel);
          targetGroup.appendChild(targetValue);
          temps.appendChild(targetGroup);
        }
        
        card.appendChild(temps);
        
        // Temperature controls (only if not off)
        if (hvacMode !== 'off' && targetTemp != null) {
          const controls = document.createElement('div');
          controls.className = 'lumina-thermostat-controls';
          
          // Decrease button
          const btnMinus = document.createElement('button');
          btnMinus.type = 'button';
          btnMinus.className = 'lumina-thermostat-btn';
          btnMinus.textContent = '−';
          btnMinus.addEventListener('click', () => {
            const newTemp = Math.max(minTemp, Number(targetTemp) - tempStep);
            this._hass.callService('climate', 'set_temperature', {
              entity_id: eid,
              temperature: newTemp
            });
          });
          controls.appendChild(btnMinus);
          
          // Slider
          const sliderContainer = document.createElement('div');
          sliderContainer.className = 'lumina-thermostat-slider';
          const sliderFill = document.createElement('div');
          sliderFill.className = 'lumina-thermostat-slider-fill';
          const sliderThumb = document.createElement('div');
          sliderThumb.className = 'lumina-thermostat-slider-thumb';
          
          const updateSlider = (temp) => {
            const percent = ((temp - minTemp) / (maxTemp - minTemp)) * 100;
            sliderFill.style.width = `${percent}%`;
            sliderThumb.style.left = `${percent}%`;
          };
          updateSlider(targetTemp);
          
          let isDragging = false;
          const handleSliderChange = (e) => {
            const rect = sliderContainer.getBoundingClientRect();
            const x = (e.type.includes('touch') ? e.touches[0].clientX : e.clientX) - rect.left;
            const percent = Math.max(0, Math.min(1, x / rect.width));
            const newTemp = minTemp + percent * (maxTemp - minTemp);
            const steppedTemp = Math.round(newTemp / tempStep) * tempStep;
            const clampedTemp = Math.max(minTemp, Math.min(maxTemp, steppedTemp));
            updateSlider(clampedTemp);
            return clampedTemp;
          };
          
          const startDrag = (e) => {
            isDragging = true;
            e.preventDefault();
          };
          
          const drag = (e) => {
            if (isDragging) {
              handleSliderChange(e);
            }
          };
          
          const endDrag = (e) => {
            if (isDragging) {
              const newTemp = handleSliderChange(e);
              this._hass.callService('climate', 'set_temperature', {
                entity_id: eid,
                temperature: newTemp
              });
              isDragging = false;
            }
          };
          
          sliderContainer.addEventListener('mousedown', startDrag);
          sliderContainer.addEventListener('touchstart', startDrag);
          document.addEventListener('mousemove', drag);
          document.addEventListener('touchmove', drag);
          document.addEventListener('mouseup', endDrag);
          document.addEventListener('touchend', endDrag);
          
          // Store listeners for cleanup
          sliderListeners.push(
            { type: 'mousemove', handler: drag },
            { type: 'touchmove', handler: drag },
            { type: 'mouseup', handler: endDrag },
            { type: 'touchend', handler: endDrag }
          );
          
          sliderContainer.appendChild(sliderFill);
          sliderContainer.appendChild(sliderThumb);
          controls.appendChild(sliderContainer);
          
          // Increase button
          const btnPlus = document.createElement('button');
          btnPlus.type = 'button';
          btnPlus.className = 'lumina-thermostat-btn';
          btnPlus.textContent = '+';
          btnPlus.addEventListener('click', () => {
            const newTemp = Math.min(maxTemp, Number(targetTemp) + tempStep);
            this._hass.callService('climate', 'set_temperature', {
              entity_id: eid,
              temperature: newTemp
            });
          });
          controls.appendChild(btnPlus);
          
          card.appendChild(controls);
        }
        
        // HVAC mode buttons
        if (hvacModes.length > 0) {
          const modes = document.createElement('div');
          modes.className = 'lumina-thermostat-modes';
          
          const modeLabels = {
            'off': 'OFF',
            'heat': 'HEAT',
            'cool': 'COOL',
            'heat_cool': 'AUTO',
            'auto': 'AUTO',
            'dry': 'DRY',
            'fan_only': 'FAN'
          };
          
          hvacModes.forEach(mode => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'lumina-thermostat-mode-btn';
            if (mode === hvacMode) btn.classList.add('active');
            btn.textContent = modeLabels[mode] || mode.toUpperCase();
            btn.addEventListener('click', () => {
              this._hass.callService('climate', 'set_hvac_mode', {
                entity_id: eid,
                hvac_mode: mode
              });
            });
            modes.appendChild(btn);
          });
          
          card.appendChild(modes);
        }
        
        return card;
      };
      
      // Store event listeners for cleanup
      const sliderListeners = [];
      
      // Create cards for each entity
      entityIds.forEach((eid) => {
        const s = this._hass && this._hass.states && this._hass.states[eid];
        // Check if it's a climate entity by domain or by checking if it has hvac_modes attribute
        const domain = eid ? eid.split('.')[0] : '';
        const hasClimateAttrs = s && s.attributes && s.attributes.hvac_modes;
        const isClimate = s && (domain === 'climate' || hasClimateAttrs);
        
        if (isClimate) {
          // Create thermostat control card
          const thermostatCard = createThermostatCard(eid);
          if (thermostatCard) {
            list.appendChild(thermostatCard);
          }
        } else {
          // Create simple temperature display row (for sensors)
          const row = document.createElement('div');
          row.className = 'lumina-house-popup-list-row';
          const nameEl = document.createElement('div');
          nameEl.className = 'lumina-house-popup-list-name';
          nameEl.textContent = getEntityName(eid);
          const valueEl = document.createElement('div');
          valueEl.className = 'lumina-house-popup-list-value';
          const v = (s && s.attributes && (s.attributes.temperature != null || s.attributes.current_temperature != null)) ? (s.attributes.temperature ?? s.attributes.current_temperature) : (s && s.state);
          const u = (s && s.attributes && s.attributes.unit_of_measurement) ? String(s.attributes.unit_of_measurement) : '°C';
          valueEl.textContent = (v != null && v !== '') ? `${v} ${u}` : '—';
          row.appendChild(nameEl);
          row.appendChild(valueEl);
          list.appendChild(row);
        }
      });
      
      // Store slider listeners in overlay for cleanup
      overlay._sliderListeners = sliderListeners;
      
      overlay.addEventListener('click', (e) => { if (e.target === overlay) this._closeHouseIconPopup(); });
      const root = typeof document !== 'undefined' && document.body ? document.body : (this.shadowRoot || this);
      root.appendChild(overlay);
      this._houseIconPopupOverlay = overlay;
      return;
    }

    if (iconKey === 'humidity') {
      const entityIds = [1, 2, 3, 4, 5, 6].map(i => cfg(`house_humidity_${i}`)).filter(Boolean);
      if (entityIds.length === 0) return;
      const overlay = document.createElement('div');
      overlay.className = 'lumina-house-popup-overlay';
      overlay.setAttribute('data-role', 'house-icon-popup-overlay');
      const popupStyle = document.createElement('style');
      popupStyle.textContent = `
        .lumina-house-popup-overlay { position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:99999;display:flex;align-items:center;justify-content:center;padding:clamp(8px,2vmin,16px);box-sizing:border-box;overflow:auto;-webkit-overflow-scrolling:touch; }
        .lumina-house-popup-panel { position:relative;width:100%;max-width:min(96vw,1200px);height:max-content;min-height:40vh;max-height:96vh;overflow:auto;background:#001428;border:2px solid #00FFFF;border-radius:clamp(8px,2vmin,12px);padding:clamp(12px,3vmin,24px);box-shadow:0 0 24px rgba(0,255,255,0.3);box-sizing:border-box; }
        .lumina-house-popup-title { color:#00FFFF;font-family:Orbitron,sans-serif;font-size:clamp(14px,3vmin,18px);margin-bottom:clamp(10px,2vmin,16px);padding-right:clamp(44px,10vmin,52px); }
        .lumina-house-popup-list { display:flex;flex-direction:column;gap:clamp(6px,1.5vmin,10px); }
        .lumina-house-popup-list-row { display:flex;align-items:center;gap:12px;padding:clamp(8px,2vmin,12px);background:#0a1628;border:1px solid #00FFFF;border-radius:8px; }
        .lumina-house-popup-list-name { color:#00FFFF;font-family:Orbitron,sans-serif;font-size:clamp(12px,2.5vmin,16px);flex:1;min-width:0;word-break:break-word; }
        .lumina-house-popup-list-value { color:rgba(0,255,255,0.9);font-family:Orbitron,sans-serif;font-size:clamp(12px,2.5vmin,16px); }
        .lumina-house-popup-close { position:absolute;top:clamp(8px,2vmin,12px);right:clamp(8px,2vmin,12px);width:clamp(32px,8vmin,40px);height:clamp(32px,8vmin,40px);border-radius:50%;border:2px solid #00FFFF;background:rgba(0,20,40,0.9);color:#00FFFF;font-size:clamp(18px,4vmin,24px);line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;z-index:2;touch-action:manipulation; }
        .lumina-house-popup-close:hover { background:rgba(0,255,255,0.2); }
      `;
      overlay.appendChild(popupStyle);
      const panel = document.createElement('div');
      panel.className = 'lumina-house-popup-panel';
      overlay.appendChild(panel);
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'lumina-house-popup-close';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => this._closeHouseIconPopup());
      panel.appendChild(closeBtn);
      const title = document.createElement('div');
      title.className = 'lumina-house-popup-title';
      title.textContent = t.humidity;
      panel.appendChild(title);
      const list = document.createElement('div');
      list.className = 'lumina-house-popup-list';
      panel.appendChild(list);
      const getEntityName = (eid) => {
        const ent = this._hass && this._hass.states && this._hass.states[eid];
        const fn = ent && ent.attributes && ent.attributes.friendly_name;
        return (fn && typeof fn === 'string' && fn.trim()) ? fn.trim() : eid;
      };
      entityIds.forEach((eid) => {
        const row = document.createElement('div');
        row.className = 'lumina-house-popup-list-row';
        const nameEl = document.createElement('div');
        nameEl.className = 'lumina-house-popup-list-name';
        nameEl.textContent = getEntityName(eid);
        const valueEl = document.createElement('div');
        valueEl.className = 'lumina-house-popup-list-value';
        const s = this._hass && this._hass.states && this._hass.states[eid];
        const v = (s && s.attributes && (s.attributes.humidity != null)) ? s.attributes.humidity : (s && s.state);
        const u = (s && s.attributes && s.attributes.unit_of_measurement) ? String(s.attributes.unit_of_measurement) : '%';
        valueEl.textContent = (v != null && v !== '') ? `${v} ${u}` : '—';
        row.appendChild(nameEl);
        row.appendChild(valueEl);
        list.appendChild(row);
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) this._closeHouseIconPopup(); });
      const root = typeof document !== 'undefined' && document.body ? document.body : (this.shadowRoot || this);
      root.appendChild(overlay);
      this._houseIconPopupOverlay = overlay;
    }
  }

  _closeHouseIconPopup() {
    const ov = this._houseIconPopupOverlay;
    if (ov && ov.parentNode) {
      ov.querySelectorAll('[data-lumina-camera-cell]').forEach((el) => {
        if (el._luminaRefresh) {
          clearInterval(el._luminaRefresh);
          el._luminaRefresh = null;
        }
        const streamEl = el._luminaStreamEl;
        if (streamEl && streamEl.parentNode) {
          try {
            if (streamEl.stop && typeof streamEl.stop === 'function') streamEl.stop();
            else if (streamEl.disconnect && typeof streamEl.disconnect === 'function') streamEl.disconnect();
          } catch (e) { /* ignore */ }
          streamEl.parentNode.removeChild(streamEl);
        }
        el._luminaStreamEl = null;
      });
      
      // Cleanup slider event listeners
      if (ov._sliderListeners && Array.isArray(ov._sliderListeners)) {
        ov._sliderListeners.forEach(({ type, handler }) => {
          document.removeEventListener(type, handler);
        });
        ov._sliderListeners = null;
      }
      
      ov.parentNode.removeChild(ov);
      this._houseIconPopupOverlay = null;
    }
  }

  _updateTextVisibility() {
    if (!this._domRefs || !this._domRefs.svgRoot) return;
    
    const config = this.config || {};
    const textVisibilitySensorId = config.text_visibility_sensor ? config.text_visibility_sensor.trim() : null;
    
    const verifyFeatureAuth = (inputValue) => {
      if (!inputValue || typeof inputValue !== 'string') return false;
      try {
        const hashHex = LUMINA_SHA256(inputValue.trim());
        const ok = LUMINA_AUTH_LIST && LUMINA_AUTH_LIST.includes(hashHex);
        if (inputValue.trim() && LUMINA_AUTH_LIST === null) {
          LUMINA_REFRESH_AUTH(() => { this._forceRender = true; this.render(); });
        }
        return ok;
      } catch (e) { return false; }
    };
    const authInput = config.pro_password;
    const isProEnabled = verifyFeatureAuth(authInput);
    const hasTextVisibilitySensor = isProEnabled && textVisibilitySensorId && this._hass && this._hass.states && this._hass.states[textVisibilitySensorId];
    
    let motionDetected = false;
    let sensorStateRaw = null;
    let sensorValueNorm = '';
    if (hasTextVisibilitySensor) {
      const sensorState = this._hass.states[textVisibilitySensorId];
      sensorStateRaw = sensorState && sensorState.state != null ? String(sensorState.state) : null;
      sensorValueNorm = sensorStateRaw ? sensorStateRaw.trim().toLowerCase() : '';
      const motionValues = ['on', 'active', 'detected', 'true', '1', 'yes', 'motion', 'occupied', 'open', 'present', 'person'];
      motionDetected = motionValues.includes(sensorValueNorm);
      if (motionDetected) {
        this._motionLastDetectedAt = Date.now();
        if (this._motionHideTimer) {
          clearTimeout(this._motionHideTimer);
          this._motionHideTimer = null;
        }
        this._motionHideTimer = setTimeout(() => {
          this._motionHideTimer = null;
          this._updateTextVisibility();
        }, 60000);
      }
    }
    const MOTION_KEEPALIVE_MS = 60000;
    const motionVisibility = hasTextVisibilitySensor && (
      motionDetected ||
      (this._motionLastDetectedAt != null && (Date.now() - this._motionLastDetectedAt) < MOTION_KEEPALIVE_MS)
    );
    
    // Check if any entities are configured (if yes, texts should be visible automatically)
    // Helper function to safely check if a sensor is configured
    // Optimized: check with early exit
    let hasCustomText = false;
    for (let i = 1; i <= 5 && !hasCustomText; i++) {
      if (config[`custom_text_${i}_enabled`] === true) {
        const text = config[`custom_text_${i}_text`];
        const sensor = config[`custom_text_${i}_sensor`];
        if ((text && typeof text === 'string' && text.trim().length > 0) ||
            (sensor && typeof sensor === 'string' && sensor.trim().length > 0)) {
          hasCustomText = true;
        }
      }
    }
    // Check solar forecast
    if (!hasCustomText && config.solar_forecast_enabled === true) {
      const solarForecastSensor = config.sensor_solar_forecast;
      if (solarForecastSensor && typeof solarForecastSensor === 'string' && solarForecastSensor.trim().length > 0) {
        hasCustomText = true;
      }
    }
    const sensorKeys = [
      'sensor_home_load', 'sensor_home_load_secondary', 'sensor_pv_total', 'sensor_pv_total_secondary',
      'sensor_pv1', 'sensor_pv2', 'sensor_pv3', 'sensor_pv4', 'sensor_pv5', 'sensor_pv6',
      'sensor_pv_array2_1', 'sensor_pv_array2_2', 'sensor_pv_array2_3', 'sensor_pv_array2_4', 'sensor_pv_array2_5', 'sensor_pv_array2_6',
      'sensor_bat1_soc', 'sensor_bat1_power', 'sensor_bat2_soc', 'sensor_bat2_power',
      'sensor_bat3_soc', 'sensor_bat3_power', 'sensor_bat4_soc', 'sensor_bat4_power',
      'sensor_battery_flow', 'sensor_battery_charge', 'sensor_battery_discharge',
      'sensor_grid_power', 'sensor_grid_import', 'sensor_grid_export',
      'sensor_car_power', 'sensor_car_soc', 'sensor_car2_power', 'sensor_car2_soc',
      'sensor_heat_pump_consumption', 'sensor_solar_forecast'
    ];
    let hasConfiguredEntities = hasCustomText;
    if (!hasConfiguredEntities) {
      for (let i = 0; i < sensorKeys.length && !hasConfiguredEntities; i++) {
        const val = config[sensorKeys[i]];
        if (val && typeof val === 'string' && val.trim().length > 0) {
          hasConfiguredEntities = true;
        }
      }
    }
    
    let shouldShowTexts;
    let shouldShowBoxes;
    const enableTextToggleButton = Boolean(this.config && this.config.enable_text_toggle_button);
    
    if (hasTextVisibilitySensor) {
      const motionActive = motionVisibility;
      shouldShowTexts = (this._textsVisible !== 2) || motionActive;
      shouldShowBoxes = (this._textsVisible === 0) || motionActive;
    } else if (enableTextToggleButton) {
      // State 0: all visible, State 1: grid/pv boxes and lines hidden, State 2: all hidden
      shouldShowTexts = this._textsVisible !== 2;
      shouldShowBoxes = this._textsVisible === 0;
    } else {
      shouldShowTexts = hasConfiguredEntities;
      shouldShowBoxes = hasConfiguredEntities;
    }
    
    // Update regular texts (excluding box lines)
    const textElements = this._domRefs.svgRoot.querySelectorAll('[data-role*="pv-line"], [data-role*="battery"], [data-role*="load"], [data-role*="house-temp"], [data-role*="heat-pump"], [data-role*="grid"]:not([data-role*="grid-box"]), [data-role*="car"], [data-role*="title"], [data-role*="daily"], [data-role*="custom-text"]');
    let textUpdated = 0;
    textElements.forEach(textEl => {
      if (textEl.tagName === 'text' || textEl.getAttribute('data-role')?.startsWith('custom-text')) {
        if (shouldShowTexts) {
          textEl.classList.remove('text-hidden');
        } else {
          textEl.classList.add('text-hidden');
        }
        textUpdated++;
      }
    });
    
    // Update boxes separately (PV and Grid boxes) - hide in state 1 and state 2
    const boxElements = this._domRefs.svgRoot.querySelectorAll('[data-role="grid-box"], [data-role="pv-box"], [data-role*="grid-box-line"], [data-role*="pv-box-line"]');
    boxElements.forEach(boxEl => {
      if (shouldShowBoxes) {
        boxEl.classList.remove('text-hidden');
      } else {
        boxEl.classList.add('text-hidden');
      }
    });
    
    // Update linea box paths (hide only grid and pv box lines in state 1)
    const lineaBoxPaths = this._domRefs.svgRoot.querySelectorAll('[data-role="linea-box-1"], [data-role="linea-box-2"]');
    lineaBoxPaths.forEach(pathEl => {
      if (shouldShowBoxes) {
        pathEl.classList.remove('text-hidden');
      } else {
        pathEl.classList.add('text-hidden');
      }
    });
  }

  _handleEchoAliveClick(event) {
    try {
      if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
      const container = (event && event.currentTarget)
        ? event.currentTarget
        : (this._domRefs ? this._domRefs.echoAliveContainer : null);
      if (!container) {
        return;
      }
      if (this._echoAliveClickTimeout) {
        try {
          clearTimeout(this._echoAliveClickTimeout);
        } catch (e) {
          // ignore
        }
        this._echoAliveClickTimeout = null;
      }
      if (typeof container.classList?.add === 'function') {
        container.classList.add('clicked');
      }
      this._echoAliveClickTimeout = setTimeout(() => {
        try {
          if (typeof container.classList?.remove === 'function') {
            container.classList.remove('clicked');
          }
        } catch (e) {
          // ignore
        } finally {
          this._echoAliveClickTimeout = null;
        }
      }, 500);
    } catch (error) {
      // ignore
    }
  }

  _snapshotViewState(viewState) {
    return {
      backgroundImage: viewState.backgroundImage,
      animationStyle: viewState.animationStyle,
      title: { ...viewState.title },
      pv: {
        fontSize: viewState.pv.fontSize,
        lines: viewState.pv.lines.map((line) => ({ ...line }))
      },
      socBar: viewState.socBar ? { ...viewState.socBar } : undefined,
      hidePvAndBattery: Boolean(viewState.hidePvAndBattery),
      gridBox: viewState.gridBox ? { ...viewState.gridBox, lines: (viewState.gridBox.lines || []).map(l => ({ ...l })) } : undefined,
      pvBox: viewState.pvBox ? { ...viewState.pvBox, lines: (viewState.pvBox.lines || []).map(l => ({ ...l })) } : undefined,
      batterySoc: { ...viewState.batterySoc },
      batteryPower: { ...viewState.batteryPower },
      load: { ...viewState.load },
      grid: { ...viewState.grid },
      heatPump: { ...viewState.heatPump },
      car1: viewState.car1 ? {
        visible: viewState.car1.visible,
        label: { ...viewState.car1.label },
        power: { ...viewState.car1.power },
        soc: { ...viewState.car1.soc }
      } : undefined,
      car2: viewState.car2 ? {
        visible: viewState.car2.visible,
        label: { ...viewState.car2.label },
        power: { ...viewState.car2.power },
        soc: { ...viewState.car2.soc }
      } : undefined,
      flows: Object.fromEntries(Object.entries(viewState.flows).map(([key, value]) => [key, { ...value }])),
      flowPaths: { ...viewState.flowPaths },
      showDebugGrid: Boolean(viewState.showDebugGrid)
    };
  }

  static get version() {
    return '2.0';
  }
}

if (!customElements.get('lumina-energy-card')) {
  customElements.define('lumina-energy-card', LuminaEnergyCard);
}

class LuminaEnergyCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._rendered = false;
    this._defaults = (typeof LuminaEnergyCard !== 'undefined' && typeof LuminaEnergyCard.getStubConfig === 'function')
      ? { ...LuminaEnergyCard.getStubConfig() }
      : {};
    this._strings = this._buildStrings();
    this._sectionOpenState = {};
  }

  _buildStrings() {
    return {
      en: {
        sections: {
          language: { title: 'Language', helper: 'Choose the editor language.' },
          installation_type: { title: 'Installation Type', helper: 'Select your installation type to configure the card accordingly.' },
          general: { title: 'General Settings', helper: 'Card metadata, background, and update cadence.' },
          array1: { title: 'Array 1', helper: 'Choose the PV, battery, grid, load, and EV entities used by the card. Either the PV total sensor or your PV string arrays need to be specified as a minimum.' },
          array2: { title: 'Array 2', helper: 'If PV Total Sensor (Inverter 2) is set or the PV String values are provided, Array 2 will become active and enable the second inverter. You must also enable Daily Production Sensor (Array 2) and Home Load (Inverter 2).' },
          battery: { title: 'Battery', helper: 'Configure battery entities.' },
          grid: { title: 'Grid/House', helper: 'Configure grid and house entities.' },
          car: { title: 'Car', helper: 'Configure EV entities.' },
          heatPump: { title: 'Heat Pump', helper: 'Configure the heat pump power entity. Flow and text are shown only when configured.' },
          house_management: { title: 'House Management', helper: 'Assign entities to Home icon buttons (cameras, lights, temperature, security, humidity). Up to 6 per icon. Click camera icon to open stream popup.' },
          pvPopup: { title: 'PV Popup', helper: 'Configure entities for the PV popup display.' },
          housePopup: { title: 'House Popup', helper: 'Configure entities for the house popup display. Entities like lights, switches, and input_booleans will show a toggle switch for control.' },
          batteryPopup: { title: 'Battery Popup', helper: 'Configure battery popup display.' },
          gridPopup: { title: 'Grid Popup', helper: 'Configure entities for the grid popup display.' },
          inverterPopup: { title: 'Inverter Popup', helper: 'Configure entities for the inverter popup display.' },
          colors: { title: 'Color & Thresholds', helper: 'Configure grid thresholds and accent colours for flows and EV display.' },
          flow_colors: { title: 'Flow Colors', helper: 'Configure colors for energy flow animations.' },
          animation_styles: { title: 'Animation Styles', helper: 'Flow animation style (dashes, dots, arrows, shimmer). Default: shimmer.' },
          typography: { title: 'Typography', helper: 'Fine tune the font sizes used across the card.' },
          flow_path_custom: { title: 'Custom Flow Paths', helper: 'Customize flow paths by modifying SVG path strings. Leave empty to use default paths. You can combine custom paths with offsets from the Flow Path section.' },
          lumina_pro: { title: 'Lumina PRO', helper: '⚠️ PRO FEATURES: Premium functions including overlay images, custom flows, and custom texts. To unlock: send 1€ to PayPal (3dprint8616@gmail.com) with your email in the message.' },
          layout: { title: 'Layout & Text Positions', helper: 'Sliders show exact X, Y (px) and angles (°). Use step 1 to get precise values—note them for your definitive YAML config. ViewBox 800×450. Save and check dashboard. YAML: dev_text_*_x, _y, _rotate, _skewX, _skewY, _scaleX, _scaleY.' },
          socBar: { title: 'SOC Bar', helper: '6-segment bar on battery. Position, opacity, glow, colors.' },
          gridBox: { title: 'Grid Box', helper: 'Top-right box. Import/Export + daily. Position and size.' },
          pvBox: { title: 'PV Box', helper: 'Top-left box. PV Total (sum) + Daily production. Position and size.' },
          batteryFill: { title: 'Battery Fill Position', helper: 'Sliders show exact coordinates (px) and angles (°). Note values for definitive YAML. YAML: dev_battery_fill_x, _y_base, _width, _max_height, _rotate, _skew_x, _skew_y.' },
          overlay_image: { title: 'Overlay Image (PRO Feature)', helper: '⚠️ PRO FEATURE: Add up to 5 custom PNG images overlayed on the card (cars, pools, turbines, etc.). Each image has independent controls for position (X/Y), size (width/height), and opacity. Perfect for adding realistic visual elements to your energy dashboard. Examples included: car.png, car_real.png, Pool.png, pool_real.png, turbine.png. To unlock: send 1€ to PayPal (3dprint8616@gmail.com) with your email.' },
          custom_flows: { title: 'Custom Flows', helper: 'Create up to 5 additional animated energy flows with custom sensors, SVG paths, colors, and activation thresholds. Each flow can have independent source/destination positions, line colors, glow effects, and power thresholds. Perfect for visualizing custom loads (pool pump, heat pump, EV charger, etc.) or additional energy sources. Flows animate automatically when sensor values exceed the threshold.' },
          custom_text: { title: 'Custom Text', helper: 'Add up to 5 custom text labels anywhere on the card. Each text can display: static labels, sensor values (with unit), or both combined. Configure position (X/Y), color, font size, and format. Perfect for showing additional data like temperatures, humidity, power consumption, or custom status messages on your energy dashboard.' },
          about: { title: 'About', helper: 'Credits, version, and helpful links.' }
        },
        fields: {
          card_title: { label: 'Card Title', helper: 'Title displayed at the top of the card. Leave blank to disable.' },
          pro_password: { label: 'PRO Password', helper: 'Enter PRO password to unlock premium features like Overlay Image. To unlock: send 1€ to PayPal (3dprint8616@gmail.com) with your email in the message.' },
          overlay_image_enabled: { label: 'Enable Overlay Image 1', helper: 'Enable or disable the first overlay image. Toggle to show/hide the image on your card.' },
          overlay_image: { label: 'Overlay Image 1 Path', helper: 'Path to your PNG image. Default example: /local/community/lumina-energy-card/car.png. Upload custom images to /config/www/ and reference as /local/filename.png. Supports transparent PNG for realistic overlay effects.' },
          overlay_image_x: { label: 'Overlay Image 1 X Position (px)', helper: 'Horizontal position from left edge. Use negative values to move left, positive to move right. Adjust in real-time using the visual editor. Range: -800 to 1600. Default: 0.' },
          overlay_image_y: { label: 'Overlay Image 1 Y Position (px)', helper: 'Vertical position from top edge. Use negative values to move up, positive to move down. Adjust in real-time using the visual editor. Range: -450 to 900. Default: 0.' },
          overlay_image_width: { label: 'Overlay Image 1 Width (px)', helper: 'Width of the image in pixels. Adjust to scale the image proportionally with height. Tip: Maintain aspect ratio for best visual results. Default: 800.' },
          overlay_image_height: { label: 'Overlay Image 1 Height (px)', helper: 'Height of the image in pixels. Adjust to scale the image proportionally with width. Tip: Maintain aspect ratio for best visual results. Default: 450.' },
          overlay_image_opacity: { label: 'Overlay Image 1 Opacity', helper: 'Transparency level: 0.0 = fully transparent (invisible), 1.0 = fully opaque (solid). Use values like 0.5 for semi-transparent overlay effects. Default: 1.0.' },
          overlay_image_2_enabled: { label: 'Enable Overlay Image 2', helper: 'Enable or disable the second overlay image. Stack multiple images for complex visualizations.' },
          overlay_image_2: { label: 'Overlay Image 2 Path', helper: 'Path to second PNG image. Default example: /local/community/lumina-energy-card/car_real.png. Layer multiple images to create realistic scenes with different elements.' },
          overlay_image_2_x: { label: 'Overlay Image 2 X Position (px)', helper: 'Horizontal position of the second overlay image. Default: 0.' },
          overlay_image_2_y: { label: 'Overlay Image 2 Y Position (px)', helper: 'Vertical position of the second overlay image. Default: 0.' },
          overlay_image_2_width: { label: 'Overlay Image 2 Width (px)', helper: 'Width of the second overlay image. Default: 800.' },
          overlay_image_2_height: { label: 'Overlay Image 2 Height (px)', helper: 'Height of the second overlay image. Default: 450.' },
          overlay_image_2_opacity: { label: 'Overlay Image 2 Opacity', helper: 'Opacity of the second overlay image (0.0 to 1.0). Default: 1.0.' },
          overlay_image_3_enabled: { label: 'Enable Overlay Image 3', helper: 'Enable or disable the third overlay image. Add more visual elements to your energy dashboard.' },
          overlay_image_3: { label: 'Overlay Image 3 Path', helper: 'Path to third PNG image. Default example: /local/community/lumina-energy-card/Pool.png. Perfect for showing swimming pools, water heaters, or other energy consumers.' },
          overlay_image_3_x: { label: 'Overlay Image 3 X Position (px)', helper: 'Horizontal position of the third overlay image. Default: 0.' },
          overlay_image_3_y: { label: 'Overlay Image 3 Y Position (px)', helper: 'Vertical position of the third overlay image. Default: 0.' },
          overlay_image_3_width: { label: 'Overlay Image 3 Width (px)', helper: 'Width of the third overlay image. Default: 800.' },
          overlay_image_3_height: { label: 'Overlay Image 3 Height (px)', helper: 'Height of the third overlay image. Default: 450.' },
          overlay_image_3_opacity: { label: 'Overlay Image 3 Opacity', helper: 'Opacity of the third overlay image (0.0 to 1.0). Default: 1.0.' },
          overlay_image_4_enabled: { label: 'Enable Overlay Image 4', helper: 'Enable or disable the fourth overlay image. Combine multiple overlays for detailed visualizations.' },
          overlay_image_4: { label: 'Overlay Image 4 Path', helper: 'Path to fourth PNG image. Default example: /local/community/lumina-energy-card/pool_real.png. Use realistic or stylized images based on your preference.' },
          overlay_image_4_x: { label: 'Overlay Image 4 X Position (px)', helper: 'Horizontal position of the fourth overlay image. Default: 0.' },
          overlay_image_4_y: { label: 'Overlay Image 4 Y Position (px)', helper: 'Vertical position of the fourth overlay image. Default: 0.' },
          overlay_image_4_width: { label: 'Overlay Image 4 Width (px)', helper: 'Width of the fourth overlay image. Default: 800.' },
          overlay_image_4_height: { label: 'Overlay Image 4 Height (px)', helper: 'Height of the fourth overlay image. Default: 450.' },
          overlay_image_4_opacity: { label: 'Overlay Image 4 Opacity', helper: 'Opacity of the fourth overlay image (0.0 to 1.0). Default: 1.0.' },
          overlay_image_5_enabled: { label: 'Enable Overlay Image 5', helper: 'Enable or disable the fifth overlay image. Maximum flexibility with 5 independent overlay layers.' },
          overlay_image_5: { label: 'Overlay Image 5 Path', helper: 'Path to fifth PNG image. Default example: /local/community/lumina-energy-card/turbine.png. Great for wind turbines, solar panels, generators, or any renewable energy source.' },
          overlay_image_5_x: { label: 'Overlay Image 5 X Position (px)', helper: 'Horizontal position of the fifth overlay image. Default: 0.' },
          overlay_image_5_y: { label: 'Overlay Image 5 Y Position (px)', helper: 'Vertical position of the fifth overlay image. Default: 0.' },
          overlay_image_5_width: { label: 'Overlay Image 5 Width (px)', helper: 'Width of the fifth overlay image. Default: 800.' },
          overlay_image_5_height: { label: 'Overlay Image 5 Height (px)', helper: 'Height of the fifth overlay image. Default: 450.' },
          overlay_image_5_opacity: { label: 'Overlay Image 5 Opacity', helper: 'Opacity of the fifth overlay image (0.0 to 1.0). Default: 1.0.' },
          language: { label: 'Language', helper: 'Choose the editor language.' },
          display_unit: { label: 'Display Unit', helper: 'Unit used when formatting power values.' },
          update_interval: { label: 'Update Interval', helper: 'Refresh cadence for card updates (0 disables throttling).' },
          animation_speed_factor: { label: 'Animation Speed Factor', helper: 'Adjust animation speed multiplier (-3x to 3x). Set 0 to pause; negatives reverse direction.' },
          animation_style: { label: 'Animation Style', helper: 'Choose the flow animation motif (dashes, dots, arrows, or shimmer).' },
          flow_stroke_width: { label: 'Flow Stroke Width (px)', helper: 'Optional override for the animated flow stroke width (no SVG edits). Leave blank to keep SVG defaults.' },
          
          // Flow Path offsets
          pv1_flow_offset_x: { label: 'PV1 Flow Offset X (px)', helper: 'Horizontal offset for PV1 flow path. Positive = right, negative = left.' },
          pv1_flow_offset_y: { label: 'PV1 Flow Offset Y (px)', helper: 'Vertical offset for PV1 flow path. Positive = down, negative = up.' },
          pv2_flow_offset_x: { label: 'PV2 Flow Offset X (px)', helper: 'Horizontal offset for PV2 flow path. Positive = right, negative = left.' },
          pv2_flow_offset_y: { label: 'PV2 Flow Offset Y (px)', helper: 'Vertical offset for PV2 flow path. Positive = down, negative = up.' },
          bat_flow_offset_x: { label: 'Battery Flow Offset X (px)', helper: 'Horizontal offset for battery flow path. Positive = right, negative = left.' },
          bat_flow_offset_y: { label: 'Battery Flow Offset Y (px)', helper: 'Vertical offset for battery flow path. Positive = down, negative = up.' },
          load_flow_offset_x: { label: 'Load Flow Offset X (px)', helper: 'Horizontal offset for load flow path. Positive = right, negative = left.' },
          load_flow_offset_y: { label: 'Load Flow Offset Y (px)', helper: 'Vertical offset for load flow path. Positive = down, negative = up.' },
          grid_flow_offset_x: { label: 'Grid Flow Offset X (px)', helper: 'Horizontal offset for grid flow path. Positive = right, negative = left.' },
          grid_flow_offset_y: { label: 'Grid Flow Offset Y (px)', helper: 'Vertical offset for grid flow path. Positive = down, negative = up.' },
          grid_house_flow_offset_x: { label: 'Grid-House Flow Offset X (px)', helper: 'Horizontal offset for grid-to-house flow path. Positive = right, negative = left.' },
          grid_house_flow_offset_y: { label: 'Grid-House Flow Offset Y (px)', helper: 'Vertical offset for grid-to-house flow path. Positive = down, negative = up.' },
          car1_flow_offset_x: { label: 'Car1 Flow Offset X (px)', helper: 'Horizontal offset for Car1 flow path. Positive = right, negative = left.' },
          car1_flow_offset_y: { label: 'Car1 Flow Offset Y (px)', helper: 'Vertical offset for Car1 flow path. Positive = down, negative = up.' },
          car2_flow_offset_x: { label: 'Car2 Flow Offset X (px)', helper: 'Horizontal offset for Car2 flow path. Positive = right, negative = left.' },
          car2_flow_offset_y: { label: 'Car2 Flow Offset Y (px)', helper: 'Vertical offset for Car2 flow path. Positive = down, negative = up.' },
          heat_pump_flow_offset_x: { label: 'Heat Pump Flow Offset X (px)', helper: 'Horizontal offset for heat pump flow path. Positive = right, negative = left.' },
          heat_pump_flow_offset_y: { label: 'Heat Pump Flow Offset Y (px)', helper: 'Vertical offset for heat pump flow path. Positive = down, negative = up.' },
          
          // Custom Flow Paths (SVG path strings)
          pv1_flow_path: { label: 'PV1 Flow Path (SVG)', helper: `Custom SVG path string for PV1 flow. Leave empty to use default. Default: ${FLOW_PATHS.pv1}` },
          pv2_flow_path: { label: 'PV2 Flow Path (SVG)', helper: `Custom SVG path string for PV2 flow. Leave empty to use default. Default: ${FLOW_PATHS.pv2}` },
          bat_flow_path: { label: 'Battery Flow Path (SVG)', helper: `Custom SVG path string for battery flow. Leave empty to use default. Default: ${FLOW_PATHS.bat}` },
          load_flow_path: { label: 'Load Flow Path (SVG)', helper: `Custom SVG path string for load flow. Leave empty to use default. Default: ${FLOW_PATHS.load}` },
          grid_flow_path: { label: 'Grid Flow Path (SVG)', helper: `Custom SVG path string for grid flow. Leave empty to use default. Default: ${FLOW_PATHS.grid}` },
          grid_house_flow_path: { label: 'Grid-House Flow Path (SVG)', helper: `Custom SVG path string for grid-to-house flow. Leave empty to use default. Default: ${FLOW_PATHS.grid_house}` },
          car1_flow_path: { label: 'Car1 Flow Path (SVG)', helper: `Custom SVG path string for Car1 flow. Leave empty to use default. Default: ${FLOW_PATHS.car1}` },
          car2_flow_path: { label: 'Car2 Flow Path (SVG)', helper: `Custom SVG path string for Car2 flow. Leave empty to use default. Default: ${FLOW_PATHS.car2}` },
          heat_pump_flow_path: { label: 'Heat Pump Flow Path (SVG)', helper: `Custom SVG path string for heat pump flow. Leave empty to use default. Default: ${FLOW_PATHS.heatPump}` },
          
          sensor_pv_total: { label: 'PV Total Sensor', helper: 'Optional aggregate production sensor displayed as the combined line.' },
          sensor_pv_total_secondary: { label: 'PV Total Sensor (Inverter 2)', helper: 'Optional second inverter total; added to the PV total when provided.' },
          sensor_pv1: { label: 'PV String 1 (Array 1)', helper: 'Primary solar production sensor.' },
          sensor_pv2: { label: 'PV String 2 (Array 1)' },
          sensor_pv3: { label: 'PV String 3 (Array 1)' },
          sensor_pv4: { label: 'PV String 4 (Array 1)' },
          sensor_pv5: { label: 'PV String 5 (Array 1)' },
          sensor_pv6: { label: 'PV String 6 (Array 1)' },
          sensor_pv_array2_1: { label: 'PV String 1 (Array 2)', helper: 'Array 2 solar production sensor.' },
          sensor_pv_array2_2: { label: 'PV String 2 (Array 2)', helper: 'Array 2 solar production sensor.' },
          sensor_pv_array2_3: { label: 'PV String 3 (Array 2)', helper: 'Array 2 solar production sensor.' },
          sensor_pv_array2_4: { label: 'PV String 4 (Array 2)', helper: 'Array 2 solar production sensor.' },
          sensor_pv_array2_5: { label: 'PV String 5 (Array 2)', helper: 'Array 2 solar production sensor.' },
          sensor_pv_array2_6: { label: 'PV String 6 (Array 2)', helper: 'Array 2 solar production sensor.' },
          show_pv_strings: { label: 'Show Individual PV Strings', helper: 'Toggle to display the total plus each PV string on separate lines.' },
          sensor_daily: { label: 'Daily Production Sensor (Required)', helper: 'Sensor reporting daily production totals. Either the PV total sensor or your PV string arrays need to be specified as a minimum.' },
          sensor_daily_array2: { label: 'Daily Production Sensor (Array 2)', helper: 'Sensor reporting daily production totals for Array 2.' },
          sensor_bat1_soc: { label: 'Battery 1 SOC' },
          sensor_bat1_power: { label: 'Battery 1 Power' },
          sensor_bat2_soc: { label: 'Battery 2 SOC' },
          sensor_bat2_power: { label: 'Battery 2 Power' },
          sensor_bat3_soc: { label: 'Battery 3 SOC' },
          sensor_bat3_power: { label: 'Battery 3 Power' },
          sensor_bat4_soc: { label: 'Battery 4 SOC' },
          sensor_bat4_power: { label: 'Battery 4 Power' },
          battery_power_mode: { label: 'Battery Power Mode', helper: 'Flow: single signed sensor (+ = charge → battery, - = discharge → inverter). Charge+Discharge: separate sensors; charge = flow to battery, discharge = flow to inverter.' },
          sensor_battery_flow: { label: 'Battery Flow (signed)', helper: 'Optional. Single power sensor: positive = charging (flow to battery), negative = discharging (flow to inverter). Used when mode is Flow. If empty, Bat 1–4 Power are used.' },
          sensor_battery_charge: { label: 'Battery Charge', helper: 'Power sensor when charging. Flow goes toward battery. Used when mode is Charge+Discharge.' },
          sensor_battery_discharge: { label: 'Battery Discharge', helper: 'Power sensor when discharging. Flow goes toward inverter. Used when mode is Charge+Discharge.' },
          sensor_home_load: { label: 'Home Load/Consumption (Required)', helper: 'Total household consumption sensor.' },
          sensor_home_load_secondary: { label: 'Home Load (Inverter 2)', helper: 'Optional house load sensor for the second inverter.' },
          sensor_heat_pump_consumption: { label: 'Heat Pump Consumption', helper: 'Sensor for heat pump energy consumption.' },
          sensor_house_temperature: { label: 'House Temperature Sensor', helper: 'Temperature sensor displayed on the house with hi-tech odometer effect.' },
          house_temperature_offset_x: { label: 'Temperature Offset X', helper: 'Horizontal offset for the temperature display (in pixels).' },
          house_temperature_offset_y: { label: 'Temperature Offset Y', helper: 'Vertical offset for the temperature display (in pixels).' },
          house_temperature_rotation: { label: 'Temperature Rotation', helper: 'Rotation angle for the temperature display (in degrees, -360 to 360).' },
          sensor_grid_power: { label: 'Grid Power', helper: 'Positive/negative grid flow sensor. Specify either this sensor or both Grid Import Sensor and Grid Export Sensor.' },
          sensor_grid_import: { label: 'Grid Import Sensor', helper: 'Optional entity reporting grid import (positive) power.' },
          sensor_grid_export: { label: 'Grid Export Sensor', helper: 'Optional entity reporting grid export (positive) power.' },
          sensor_grid_import_daily: { label: 'Daily Grid Import Sensor', helper: 'Optional entity reporting cumulative grid import for the current day.' },
          sensor_grid_export_daily: { label: 'Daily Grid Export Sensor', helper: 'Optional entity reporting cumulative grid export for the current day.' },
          pv_tot_color: { label: 'PV Total Color', helper: 'Colour applied to the PV TOTAL text line.' },
          pv_primary_color: { label: 'PV 1 Flow Color', helper: 'Colour used for the primary PV animation line.' },
          pv_secondary_color: { label: 'PV 2 Flow Color', helper: 'Colour used for the secondary PV animation line when available.' },
          pv_text_color: { label: 'PV Text Color', helper: 'Color for PV/solar labels (Array 1).' },
          pv_font_size: { label: 'PV Font Size (px)', helper: 'Font size for PV text (Array 1).' },
          pv_secondary_text_color: { label: 'Array 2 Text Color', helper: 'Color for Array 2 text labels.' },
          pv_secondary_font_size: { label: 'Array 2 Font Size (px)', helper: 'Font size for Array 2 text.' },
          pv_string1_color: { label: 'PV String 1 Color', helper: 'Override for S1 in the PV list. Leave blank to inherit the PV total color.' },
          pv_string2_color: { label: 'PV String 2 Color', helper: 'Override for S2 in the PV list. Leave blank to inherit the PV total color.' },
          pv_string3_color: { label: 'PV String 3 Color', helper: 'Override for S3 in the PV list. Leave blank to inherit the PV total color.' },
          pv_string4_color: { label: 'PV String 4 Color', helper: 'Override for S4 in the PV list. Leave blank to inherit the PV total color.' },
          pv_string5_color: { label: 'PV String 5 Color', helper: 'Override for S5 in the PV list. Leave blank to inherit the PV total color.' },
          pv_string6_color: { label: 'PV String 6 Color', helper: 'Override for S6 in the PV list. Leave blank to inherit the PV total color.' },
          load_flow_color: { label: 'Load Flow Color', helper: 'Colour applied to the home load animation line.' },
          load_text_color: { label: 'Load Text Color', helper: 'Colour applied to the home load text when thresholds are inactive.' },
          inv1_color: { label: 'INV 1 Color', helper: 'Colour applied to the INV 1 text/flow.' },
          inv2_color: { label: 'INV 2 Color', helper: 'Colour applied to the INV 2 text/flow.' },
          load_threshold_warning: { label: 'Load Warning Threshold', helper: 'Change load color when magnitude equals or exceeds this value. Uses the selected display unit.' },
          load_warning_color: { label: 'Load Warning Color', helper: 'Hex or CSS color applied at the load warning threshold.' },
          load_threshold_critical: { label: 'Load Critical Threshold', helper: 'Change load color when magnitude equals or exceeds this value. Uses the selected display unit.' },
          load_critical_color: { label: 'Load Critical Color', helper: 'Hex or CSS color applied at the load critical threshold.' },
          battery_soc_color: { label: 'Battery SOC Color', helper: 'Hex color applied to the battery SOC percentage text.' },
          battery_charge_color: { label: 'Battery Charge Flow Color', helper: 'Colour used when energy is flowing into the battery.' },
          battery_discharge_color: { label: 'Battery Discharge Flow Color', helper: 'Colour used when energy is flowing from the battery.' },
          grid_import_color: { label: 'Grid Import Flow Color', helper: 'Base colour before thresholds when importing from the grid.' },
          grid_export_color: { label: 'Grid Export Flow Color', helper: 'Base colour before thresholds when exporting to the grid.' },
          car_flow_color: { label: 'EV Flow Color', helper: 'Colour applied to the electric vehicle animation line.' },
          battery_fill_opacity: { label: 'Battery Fill Opacity', helper: 'Transparency of the battery liquid fill (0.05–1).' },
          grid_activity_threshold: { label: 'Grid Animation Threshold (W)', helper: 'Ignore grid flows whose absolute value is below this wattage before animating.' },
          grid_threshold_warning: { label: 'Grid Warning Threshold', helper: 'Change grid color when magnitude equals or exceeds this value. Uses the selected display unit.' },
          grid_warning_color: { label: 'Grid Warning Color', helper: 'Hex or CSS color applied at the warning threshold.' },
          grid_threshold_critical: { label: 'Grid Critical Threshold', helper: 'Change grid color when magnitude equals or exceeds this value. Uses the selected display unit.' },
          grid_critical_color: { label: 'Grid Critical Color', helper: 'Hex or CSS color applied at the critical threshold.' },
          invert_grid: { label: 'Invert Grid Values', helper: 'Enable if import/export polarity is reversed.' },
          enable_echo_alive: { label: 'Enable Echo Alive', helper: 'Enables an invisible iframe to keep the Silk browser open on Echo Show. The button will be positioned in a corner of the card.' },
          enable_text_toggle_button: { label: 'Enable Text Toggle Button', helper: 'Shows a button on the card to toggle text visibility on/off.' },
          text_toggle_button_x: { label: 'Text Toggle Button X (px)', helper: 'Horizontal position of the text toggle button. Left edge distance in pixels. Default: 10px (bottom-left).' },
          text_toggle_button_y: { label: 'Text Toggle Button Y (px)', helper: 'Vertical position from top in pixels. Leave empty to position at bottom. Default: bottom.' },
          text_toggle_button_scale: { label: 'Text Toggle Button Scale', helper: 'Scale factor for button size (0.5 to 2.0). 1.0 = default size.' },
          text_visibility_sensor: { label: 'Text Visibility Motion Sensor (PRO)', helper: '⚠️ PRO FEATURE: Motion sensor entity. When motion is detected, texts appear. Perfect for wall tablets with camera.' },
          solar_forecast_enabled: { label: 'Enable Solar Forecast', helper: '⚠️ PRO FEATURE: Display estimated solar production with sun status (lots/moderate/little sun).' },
          sensor_solar_forecast: { label: 'Solar Forecast Sensor', helper: 'Sensor entity for estimated solar production (in W or kW).' },
          solar_forecast_max_power: { label: 'Solar Forecast Max Power (W)', helper: 'Maximum expected power in watts. Used to calculate percentage for sun status (default: 10000W).' },
          solar_forecast_x: { label: 'Solar Forecast X Position (px)', helper: 'Horizontal position of the solar forecast text (in pixels).' },
          solar_forecast_y: { label: 'Solar Forecast Y Position (px)', helper: 'Vertical position of the solar forecast text (in pixels).' },
          solar_forecast_color: { label: 'Solar Forecast Color', helper: 'Color for the solar forecast text (default: #00FFFF).' },
          solar_forecast_size: { label: 'Solar Forecast Font Size (px)', helper: 'Font size for the solar forecast text (default: 16px).' },
          invert_battery: { label: 'Invert Battery Values', helper: 'Enable if charge/discharge polarity is reversed.' },
          sensor_car_power: { label: 'Car 1 Power Sensor' },
          sensor_car_soc: { label: 'Car 1 SOC Sensor' },
          car_soc: { label: 'Car SOC', helper: 'Sensor for EV battery SOC.' },
          car_range: { label: 'Car Range', helper: 'Sensor for EV range.' },
          car_efficiency: { label: 'Car Efficiency', helper: 'Sensor for EV efficiency.' },
          car_charger_power: { label: 'Car Charger Power', helper: 'Sensor for EV charger power.' },
          car1_label: { label: 'Car 1 Label', helper: 'Text displayed next to the first EV values.' },
          sensor_car2_power: { label: 'Car 2 Power Sensor' },
          car2_power: { label: 'Car 2 Power', helper: 'Sensor for EV 2 charge/discharge power.' },
          sensor_car2_soc: { label: 'Car 2 SOC Sensor' },
          car2_soc: { label: 'Car 2 SOC', helper: 'Sensor for EV 2 battery SOC.' },
          car2_range: { label: 'Car 2 Range', helper: 'Sensor for EV 2 range.' },
          car2_efficiency: { label: 'Car 2 Efficiency', helper: 'Sensor for EV 2 efficiency.' },
          car2_charger_power: { label: 'Car 2 Charger Power', helper: 'Sensor for EV 2 charger power.' },
          car2_label: { label: 'Car 2 Label', helper: 'Text displayed next to the second EV values.' },
          show_car_soc: { label: 'Show Car 1', helper: 'Toggle to render the first EV metrics.' },
          show_car2: { label: 'Show Car 2', helper: 'Enable to render the second EV metrics when sensors are provided.' },
          car1_bidirectional: { label: 'Car 1 Bidirectional Capacity', helper: 'Enable if Car 1 has V2X capability (can charge and discharge like a home battery).' },
          car2_bidirectional: { label: 'Car 2 Bidirectional Capacity', helper: 'Enable if Car 2 has V2X capability (can charge and discharge like a home battery).' },
          car1_invert_flow: { label: 'Car 1 Invert Flow', helper: 'Invert the flow direction for Car 1. Useful if the sensor polarity is reversed.' },
          car2_invert_flow: { label: 'Car 2 Invert Flow', helper: 'Invert the flow direction for Car 2. Useful if the sensor polarity is reversed.' },
          car_pct_color: { label: 'Car SOC Color', helper: 'Hex color for EV SOC text (e.g., #00FFFF).' },
          car2_pct_color: { label: 'Car 2 SOC Color', helper: 'Hex color for second EV SOC text (falls back to Car SOC Color).' },
          car1_name_color: { label: 'Car 1 Name Color', helper: 'Color applied to the Car 1 name label.' },
          car2_name_color: { label: 'Car 2 Name Color', helper: 'Color applied to the Car 2 name label.' },
          car1_color: { label: 'Car 1 Color', helper: 'Color applied to Car 1 power value.' },
          car2_color: { label: 'Car 2 Color', helper: 'Color applied to Car 2 power value.' },
          pro_password: { label: 'PRO Password', helper: '⚠️ PRO FEATURE: This is a premium function.' },
          paypal_button: 'Unlock PRO Features (1€)',
          paypal_note: 'IMPORTANT: Send as DONATION only. Do NOT use Goods & Services. Include your EMAIL in the PayPal notes to receive the password.',
          overlay_image_enabled: { label: 'Enable Overlay Image', helper: 'Enable or disable the custom overlay image (requires PRO authorization).' },
          heat_pump_flow_color: { label: 'Heat Pump Flow Color', helper: 'Color applied to the heat pump flow animation.' },
          heat_pump_text_color: { label: 'Heat Pump Text Color', helper: 'Color applied to the heat pump power text.' },
          text_font_size: { label: 'Text Font Size (px)', helper: 'Unified font size for all text elements (Solar, Battery, Grid, Car, Heat Pump, Home). Default: 12px.' },
          header_font_size: { label: 'Header Font Size (px)', helper: 'Default 16' },
          daily_label_font_size: { label: 'Daily Label Font Size (px)', helper: 'Default 12' },
          daily_value_font_size: { label: 'Daily Value Font Size (px)', helper: 'Default 20' },
          pv_font_size: { label: 'PV Text Font Size (px)', helper: 'Default 16' },
          battery_soc_font_size: { label: 'Battery SOC Font Size (px)', helper: 'Default 20' },
          battery_power_font_size: { label: 'Battery Power Font Size (px)', helper: 'Default 16' },
          load_font_size: { label: 'Load Font Size (px)', helper: 'Default 15' },
          heat_pump_font_size: { label: 'Heat Pump Font Size (px)', helper: 'Default 16' },
          grid_font_size: { label: 'Grid Font Size (px)', helper: 'Default 15' },
          car_power_font_size: { label: 'Car Power Font Size (px)', helper: 'Default 15' },
          car2_power_font_size: { label: 'Car 2 Power Font Size (px)', helper: 'Default 15' },
          car_name_font_size: { label: 'Car Name Font Size (px)', helper: 'Default 15' },
          car2_name_font_size: { label: 'Car 2 Name Font Size (px)', helper: 'Default 15' },
          car_soc_font_size: { label: 'Car SOC Font Size (px)', helper: 'Default 12' },
          car2_soc_font_size: { label: 'Car 2 SOC Font Size (px)', helper: 'Default 12' },
          sensor_popup_pv_1: { label: 'PV Popup 1', helper: 'Entity for PV popup line 1.' },
          sensor_popup_pv_2: { label: 'PV Popup 2', helper: 'Entity for PV popup line 2.' },
          sensor_popup_pv_3: { label: 'PV Popup 3', helper: 'Entity for PV popup line 3.' },
          sensor_popup_pv_4: { label: 'PV Popup 4', helper: 'Entity for PV popup line 4.' },
          sensor_popup_pv_5: { label: 'PV Popup 5', helper: 'Entity for PV popup line 5.' },
          sensor_popup_pv_6: { label: 'PV Popup 6', helper: 'Entity for PV popup line 6.' },
          sensor_popup_pv_1_name: { label: 'PV Popup 1 Name', helper: 'Optional custom name for PV popup line 1. Leave blank to use entity name.' },
          sensor_popup_pv_2_name: { label: 'PV Popup 2 Name', helper: 'Optional custom name for PV popup line 2. Leave blank to use entity name.' },
          sensor_popup_pv_3_name: { label: 'PV Popup 3 Name', helper: 'Optional custom name for PV popup line 3. Leave blank to use entity name.' },
          sensor_popup_pv_4_name: { label: 'PV Popup 4 Name', helper: 'Optional custom name for PV popup line 4. Leave blank to use entity name.' },
          sensor_popup_pv_5_name: { label: 'PV Popup 5 Name', helper: 'Optional custom name for PV popup line 5. Leave blank to use entity name.' },
          sensor_popup_pv_6_name: { label: 'PV Popup 6 Name', helper: 'Optional custom name for PV popup line 6. Leave blank to use entity name.' },
          sensor_popup_pv_1_color: { label: 'PV Popup 1 Color', helper: 'Color for PV popup line 1 text.' },
          sensor_popup_pv_2_color: { label: 'PV Popup 2 Color', helper: 'Color for PV popup line 2 text.' },
          sensor_popup_pv_3_color: { label: 'PV Popup 3 Color', helper: 'Color for PV popup line 3 text.' },
          sensor_popup_pv_4_color: { label: 'PV Popup 4 Color', helper: 'Color for PV popup line 4 text.' },
          sensor_popup_pv_5_color: { label: 'PV Popup 5 Color', helper: 'Color for PV popup line 5 text.' },
          sensor_popup_pv_6_color: { label: 'PV Popup 6 Color', helper: 'Color for PV popup line 6 text.' },
          sensor_popup_pv_1_font_size: { label: 'PV Popup 1 Font Size (px)', helper: 'Font size for PV popup line 1. Default 16' },
          sensor_popup_pv_2_font_size: { label: 'PV Popup 2 Font Size (px)', helper: 'Font size for PV popup line 2. Default 16' },
          sensor_popup_pv_3_font_size: { label: 'PV Popup 3 Font Size (px)', helper: 'Font size for PV popup line 3. Default 16' },
          sensor_popup_pv_4_font_size: { label: 'PV Popup 4 Font Size (px)', helper: 'Font size for PV popup line 4. Default 16' },
          sensor_popup_pv_5_font_size: { label: 'PV Popup 5 Font Size (px)', helper: 'Font size for PV popup line 5. Default 16' },
          sensor_popup_pv_6_font_size: { label: 'PV Popup 6 Font Size (px)', helper: 'Font size for PV popup line 6. Default 16' },
          sensor_popup_house_1: { label: 'House Popup 1', helper: 'Entity for house popup line 1.' },
          sensor_popup_house_1_name: { label: 'House Popup 1 Name', helper: 'Optional custom name for house popup line 1. Leave blank to use entity name.' },
          sensor_popup_house_1_color: { label: 'House Popup 1 Color', helper: 'Color for house popup line 1 text.' },
          sensor_popup_house_1_font_size: { label: 'House Popup 1 Font Size (px)', helper: 'Font size for house popup line 1. Default 16' },
          sensor_popup_house_2: { label: 'House Popup 2', helper: 'Entity for house popup line 2.' },
          sensor_popup_house_2_name: { label: 'House Popup 2 Name', helper: 'Optional custom name for house popup line 2. Leave blank to use entity name.' },
          sensor_popup_house_2_color: { label: 'House Popup 2 Color', helper: 'Color for house popup line 2 text.' },
          sensor_popup_house_2_font_size: { label: 'House Popup 2 Font Size (px)', helper: 'Font size for house popup line 2. Default 16' },
          sensor_popup_house_3: { label: 'House Popup 3', helper: 'Entity for house popup line 3.' },
          sensor_popup_house_3_name: { label: 'House Popup 3 Name', helper: 'Optional custom name for house popup line 3. Leave blank to use entity name.' },
          sensor_popup_house_3_color: { label: 'House Popup 3 Color', helper: 'Color for house popup line 3 text.' },
          sensor_popup_house_3_font_size: { label: 'House Popup 3 Font Size (px)', helper: 'Font size for house popup line 3. Default 16' },
          sensor_popup_house_4: { label: 'House Popup 4', helper: 'Entity for house popup line 4.' },
          sensor_popup_house_4_name: { label: 'House Popup 4 Name', helper: 'Optional custom name for house popup line 4. Leave blank to use entity name.' },
          sensor_popup_house_4_color: { label: 'House Popup 4 Color', helper: 'Color for house popup line 4 text.' },
          sensor_popup_house_4_font_size: { label: 'House Popup 4 Font Size (px)', helper: 'Font size for house popup line 4. Default 16' },
          sensor_popup_house_5: { label: 'House Popup 5', helper: 'Entity for house popup line 5.' },
          sensor_popup_house_5_name: { label: 'House Popup 5 Name', helper: 'Optional custom name for house popup line 5. Leave blank to use entity name.' },
          sensor_popup_house_5_color: { label: 'House Popup 5 Color', helper: 'Color for house popup line 5 text.' },
          sensor_popup_house_5_font_size: { label: 'House Popup 5 Font Size (px)', helper: 'Font size for house popup line 5. Default 16' },
          sensor_popup_house_6: { label: 'House Popup 6', helper: 'Entity for house popup line 6.' },
          sensor_popup_house_6_name: { label: 'House Popup 6 Name', helper: 'Optional custom name for house popup line 6. Leave blank to use entity name.' },
          sensor_popup_house_6_color: { label: 'House Popup 6 Color', helper: 'Color for house popup line 6 text.' },
          sensor_popup_house_6_font_size: { label: 'House Popup 6 Font Size (px)', helper: 'Font size for house popup line 6. Default 16' },
          sensor_popup_bat_1: { label: 'Battery Popup 1', helper: 'Entity for battery popup line 1.' },
          sensor_popup_bat_1_name: { label: 'Battery Popup 1 Name', helper: 'Optional custom name for battery popup line 1. Leave blank to use entity name.' },
          sensor_popup_bat_1_color: { label: 'Battery Popup 1 Color', helper: 'Color for battery popup line 1 text.' },
          sensor_popup_bat_1_font_size: { label: 'Battery Popup 1 Font Size (px)', helper: 'Font size for battery popup line 1. Default 16' },
          sensor_popup_bat_2: { label: 'Battery Popup 2', helper: 'Entity for battery popup line 2.' },
          sensor_popup_bat_2_name: { label: 'Battery Popup 2 Name', helper: 'Optional custom name for battery popup line 2. Leave blank to use entity name.' },
          sensor_popup_bat_2_color: { label: 'Battery Popup 2 Color', helper: 'Color for battery popup line 2 text.' },
          sensor_popup_bat_2_font_size: { label: 'Battery Popup 2 Font Size (px)', helper: 'Font size for battery popup line 2. Default 16' },
          sensor_popup_bat_3: { label: 'Battery Popup 3', helper: 'Entity for battery popup line 3.' },
          sensor_popup_bat_3_name: { label: 'Battery Popup 3 Name', helper: 'Optional custom name for battery popup line 3. Leave blank to use entity name.' },
          sensor_popup_bat_3_color: { label: 'Battery Popup 3 Color', helper: 'Color for battery popup line 3 text.' },
          sensor_popup_bat_3_font_size: { label: 'Battery Popup 3 Font Size (px)', helper: 'Font size for battery popup line 3. Default 16' },
          sensor_popup_bat_4: { label: 'Battery Popup 4', helper: 'Entity for battery popup line 4.' },
          sensor_popup_bat_4_name: { label: 'Battery Popup 4 Name', helper: 'Optional custom name for battery popup line 4. Leave blank to use entity name.' },
          sensor_popup_bat_4_color: { label: 'Battery Popup 4 Color', helper: 'Color for battery popup line 4 text.' },
          sensor_popup_bat_4_font_size: { label: 'Battery Popup 4 Font Size (px)', helper: 'Font size for battery popup line 4. Default 16' },
          sensor_popup_bat_5: { label: 'Battery Popup 5', helper: 'Entity for battery popup line 5.' },
          sensor_popup_bat_5_name: { label: 'Battery Popup 5 Name', helper: 'Optional custom name for battery popup line 5. Leave blank to use entity name.' },
          sensor_popup_bat_5_color: { label: 'Battery Popup 5 Color', helper: 'Color for battery popup line 5 text.' },
          sensor_popup_bat_5_font_size: { label: 'Battery Popup 5 Font Size (px)', helper: 'Font size for battery popup line 5. Default 16' },
          sensor_popup_bat_6: { label: 'Battery Popup 6', helper: 'Entity for battery popup line 6.' },
          sensor_popup_bat_6_name: { label: 'Battery Popup 6 Name', helper: 'Optional custom name for battery popup line 6. Leave blank to use entity name.' },
          sensor_popup_bat_6_color: { label: 'Battery Popup 6 Color', helper: 'Color for battery popup line 6 text.' },
          sensor_popup_bat_6_font_size: { label: 'Battery Popup 6 Font Size (px)', helper: 'Font size for battery popup line 6. Default 16' },
          sensor_popup_grid_1: { label: 'Grid Popup 1', helper: 'Entity for grid popup line 1.' },
          sensor_popup_grid_1_name: { label: 'Grid Popup 1 Name', helper: 'Optional custom name for grid popup line 1. Leave blank to use entity name.' },
          sensor_popup_grid_1_color: { label: 'Grid Popup 1 Color', helper: 'Color for grid popup line 1 text.' },
          sensor_popup_grid_1_font_size: { label: 'Grid Popup 1 Font Size (px)', helper: 'Font size for grid popup line 1. Default 16' },
          sensor_popup_grid_2: { label: 'Grid Popup 2', helper: 'Entity for grid popup line 2.' },
          sensor_popup_grid_2_name: { label: 'Grid Popup 2 Name', helper: 'Optional custom name for grid popup line 2. Leave blank to use entity name.' },
          sensor_popup_grid_2_color: { label: 'Grid Popup 2 Color', helper: 'Color for grid popup line 2 text.' },
          sensor_popup_grid_2_font_size: { label: 'Grid Popup 2 Font Size (px)', helper: 'Font size for grid popup line 2. Default 16' },
          sensor_popup_grid_3: { label: 'Grid Popup 3', helper: 'Entity for grid popup line 3.' },
          sensor_popup_grid_3_name: { label: 'Grid Popup 3 Name', helper: 'Optional custom name for grid popup line 3. Leave blank to use entity name.' },
          sensor_popup_grid_3_color: { label: 'Grid Popup 3 Color', helper: 'Color for grid popup line 3 text.' },
          sensor_popup_grid_3_font_size: { label: 'Grid Popup 3 Font Size (px)', helper: 'Font size for grid popup line 3. Default 16' },
          sensor_popup_grid_4: { label: 'Grid Popup 4', helper: 'Entity for grid popup line 4.' },
          sensor_popup_grid_4_name: { label: 'Grid Popup 4 Name', helper: 'Optional custom name for grid popup line 4. Leave blank to use entity name.' },
          sensor_popup_grid_4_color: { label: 'Grid Popup 4 Color', helper: 'Color for grid popup line 4 text.' },
          sensor_popup_grid_4_font_size: { label: 'Grid Popup 4 Font Size (px)', helper: 'Font size for grid popup line 4. Default 16' },
          sensor_popup_grid_5: { label: 'Grid Popup 5', helper: 'Entity for grid popup line 5.' },
          sensor_popup_grid_5_name: { label: 'Grid Popup 5 Name', helper: 'Optional custom name for grid popup line 5. Leave blank to use entity name.' },
          sensor_popup_grid_5_color: { label: 'Grid Popup 5 Color', helper: 'Color for grid popup line 5 text.' },
          sensor_popup_grid_5_font_size: { label: 'Grid Popup 5 Font Size (px)', helper: 'Font size for grid popup line 5. Default 16' },
          sensor_popup_grid_6: { label: 'Grid Popup 6', helper: 'Entity for grid popup line 6.' },
          sensor_popup_grid_6_name: { label: 'Grid Popup 6 Name', helper: 'Optional custom name for grid popup line 6. Leave blank to use entity name.' },
          sensor_popup_grid_6_color: { label: 'Grid Popup 6 Color', helper: 'Color for grid popup line 6 text.' },
          sensor_popup_grid_6_font_size: { label: 'Grid Popup 6 Font Size (px)', helper: 'Font size for grid popup line 6. Default 16' },
          sensor_popup_inverter_1: { label: 'Inverter Popup 1', helper: 'Entity for inverter popup line 1.' },
          sensor_popup_inverter_1_name: { label: 'Inverter Popup 1 Name', helper: 'Optional custom name for inverter popup line 1. Leave blank to use entity name.' },
          sensor_popup_inverter_1_color: { label: 'Inverter Popup 1 Color', helper: 'Color for inverter popup line 1 text.' },
          sensor_popup_inverter_1_font_size: { label: 'Inverter Popup 1 Font Size (px)', helper: 'Font size for inverter popup line 1. Default 16' },
          sensor_popup_inverter_2: { label: 'Inverter Popup 2', helper: 'Entity for inverter popup line 2.' },
          sensor_popup_inverter_2_name: { label: 'Inverter Popup 2 Name', helper: 'Optional custom name for inverter popup line 2. Leave blank to use entity name.' },
          sensor_popup_inverter_2_color: { label: 'Inverter Popup 2 Color', helper: 'Color for inverter popup line 2 text.' },
          sensor_popup_inverter_2_font_size: { label: 'Inverter Popup 2 Font Size (px)', helper: 'Font size for inverter popup line 2. Default 16' },
          sensor_popup_inverter_3: { label: 'Inverter Popup 3', helper: 'Entity for inverter popup line 3.' },
          sensor_popup_inverter_3_name: { label: 'Inverter Popup 3 Name', helper: 'Optional custom name for inverter popup line 3. Leave blank to use entity name.' },
          sensor_popup_inverter_3_color: { label: 'Inverter Popup 3 Color', helper: 'Color for inverter popup line 3 text.' },
          sensor_popup_inverter_3_font_size: { label: 'Inverter Popup 3 Font Size (px)', helper: 'Font size for inverter popup line 3. Default 16' },
          sensor_popup_inverter_4: { label: 'Inverter Popup 4', helper: 'Entity for inverter popup line 4.' },
          sensor_popup_inverter_4_name: { label: 'Inverter Popup 4 Name', helper: 'Optional custom name for inverter popup line 4. Leave blank to use entity name.' },
          sensor_popup_inverter_4_color: { label: 'Inverter Popup 4 Color', helper: 'Color for inverter popup line 4 text.' },
          sensor_popup_inverter_4_font_size: { label: 'Inverter Popup 4 Font Size (px)', helper: 'Font size for inverter popup line 4. Default 16' },
          sensor_popup_inverter_5: { label: 'Inverter Popup 5', helper: 'Entity for inverter popup line 5.' },
          sensor_popup_inverter_5_name: { label: 'Inverter Popup 5 Name', helper: 'Optional custom name for inverter popup line 5. Leave blank to use entity name.' },
          sensor_popup_inverter_5_color: { label: 'Inverter Popup 5 Color', helper: 'Color for inverter popup line 5 text.' },
          sensor_popup_inverter_5_font_size: { label: 'Inverter Popup 5 Font Size (px)', helper: 'Font size for inverter popup line 5. Default 16' },
          sensor_popup_inverter_6: { label: 'Inverter Popup 6', helper: 'Entity for inverter popup line 6.' },
          sensor_popup_inverter_6_name: { label: 'Inverter Popup 6 Name', helper: 'Optional custom name for inverter popup line 6. Leave blank to use entity name.' },
          sensor_popup_inverter_6_color: { label: 'Inverter Popup 6 Color', helper: 'Color for inverter popup line 6 text.' },
          sensor_popup_inverter_6_font_size: { label: 'Inverter Popup 6 Font Size (px)', helper: 'Font size for inverter popup line 6. Default 16' },
          overlay_image_pro_1: { label: 'Overlay Image Pro 1', helper: 'Path to overlay image pro 1 (e.g., /local/community/lumina-energy-card/overlay_pro_1.png).' },
          overlay_image_pro_2: { label: 'Overlay Image Pro 2', helper: 'Path to overlay image pro 2 (e.g., /local/community/lumina-energy-card/overlay_pro_2.png).' },
          overlay_image_pro_3: { label: 'Overlay Image Pro 3', helper: 'Path to overlay image pro 3 (e.g., /local/community/lumina-energy-card/overlay_pro_3.png).' },
          overlay_image_pro_4: { label: 'Overlay Image Pro 4', helper: 'Path to overlay image pro 4 (e.g., /local/community/lumina-energy-card/overlay_pro_4.png).' },
          overlay_image_pro_5: { label: 'Overlay Image Pro 5', helper: 'Path to overlay image pro 5 (e.g., /local/community/lumina-energy-card/overlay_pro_5.png).' },
        },
        options: {
          languages: [
            { value: 'en', label: 'English' },
            { value: 'it', label: 'Italiano' },
            { value: 'de', label: 'Deutsch' },
            { value: 'fr', label: 'Français' },
            { value: 'nl', label: 'Nederlands' }
          ],
          display_units: [
            { value: 'W', label: 'Watts (W)' },
            { value: 'kW', label: 'Kilowatts (kW)' }
          ],
          animation_styles: [
            { value: 'dashes', label: 'Dashes (default)' },
            { value: 'dots', label: 'Dots' },
            { value: 'arrows', label: 'Arrows' },
            { value: 'shimmer', label: 'Shimmer' }
          ]
        }
      ,
      view: {
        daily: 'DAILY YIELD',
        pv_tot: 'PV TOTAL',
        car1: 'CAR 1',
        car2: 'CAR 2',
        importing: 'IMPORTING',
        exporting: 'EXPORTING'
      }
      },
      it: {
        sections: {
          language: { title: 'Lingua', helper: 'Seleziona la lingua dell editor.' },
          installation_type: { title: 'Tipo di Impianto', helper: 'Seleziona il tipo di impianto per configurare la scheda di conseguenza.' },
          general: { title: 'Impostazioni generali', helper: 'Titolo scheda, sfondo e frequenza di aggiornamento.' },
          array1: { title: 'Array 1', helper: 'Configura le entita dell Array PV 1.' },
          array2: { title: 'Array 2', helper: 'Se il Sensore PV Totale (Inverter 2) è impostato o i valori delle Stringhe PV sono forniti, Array 2 diventerà attivo e abiliterà il secondo inverter. Devi anche abilitare il Sensore Produzione Giornaliera (Array 2) e il Carico Casa (Inverter 2).' },
          battery: { title: 'Batteria', helper: 'Configura le entita della batteria.' },
          grid: { title: 'Rete/Casa', helper: 'Configura le entita della rete e della casa.' },
          car: { title: 'Auto', helper: 'Configura le entita EV.' },
          heatPump: { title: 'Pompa di calore', helper: "Configura l'entita di potenza della pompa di calore. Flusso e testo visibili solo se configurata." },
          entities: { title: 'Selezione entita', helper: 'Scegli le entita PV, batteria, rete, carico ed EV utilizzate dalla scheda. Come minimo deve essere specificato il sensore PV totale oppure gli array di stringhe PV.' },
          house_management: { title: 'Gestione casa', helper: 'Assegna entità ai pulsanti icona Home (telecamere, luci, temperatura, sicurezza, umidità). Max 6 per icona. Clic sull\'icona telecamera apre il popup streaming.' },
          pvPopup: { title: 'PV Popup', helper: 'Configura le entita per la visualizzazione del popup PV.' },
          housePopup: { title: 'Popup Casa', helper: 'Configura le entità per la visualizzazione del popup casa. Le entità come luci, interruttori e input_boolean mostreranno un toggle switch per il controllo.' },
          batteryPopup: { title: 'Popup Batteria', helper: 'Configura il popup della batteria.' },
          gridPopup: { title: 'Popup Rete', helper: 'Configura le entita per la visualizzazione del popup rete.' },
          inverterPopup: { title: 'Popup Inverter', helper: 'Configura le entita per la visualizzazione del popup inverter.' },
          colors: { title: 'Colori e soglie', helper: 'Configura soglie della rete e colori di accento per i flussi.' },
          flow_colors: { title: 'Colori Flussi', helper: 'Configura i colori per le animazioni dei flussi di energia.' },
          animation_styles: { title: 'Stili Animazioni', helper: 'Stile animazione flussi (tratteggi, punti, frecce, shimmer). Predefinito: shimmer.' },
          typography: { title: 'Tipografia', helper: 'Regola le dimensioni dei caratteri utilizzate nella scheda.' },
          flow_path_custom: { title: 'Percorsi Flussi Personalizzati', helper: 'Personalizza i percorsi dei flussi modificando le stringhe SVG. Lascia vuoto per usare i percorsi predefiniti. Puoi combinare percorsi personalizzati con gli offset della sezione Percorso Flussi.' },
          lumina_pro: { title: 'Lumina PRO', helper: '⚠️ FUNZIONI PRO: Funzioni premium incluse immagini overlay, flussi personalizzati e testi personalizzati. Per sbloccare: invia 1€ a PayPal (3dprint8616@gmail.com) con la tua email nel messaggio.' },
          layout: { title: 'Layout & Posizioni Testi', helper: 'I cursori mostrano X, Y in pixel esatti e angoli (°). Step 1 per valori precisi—annotali per la YAML definitiva. ViewBox 800×450. Salva e controlla la dashboard. YAML: dev_text_*_x, _y, _rotate, _skewX, _skewY, _scaleX, _scaleY.' },
          socBar: { title: 'Barra SOC', helper: 'Barra a 6 segmenti sulla batteria. Posizione, opacità, alone, colori.' },
          gridBox: { title: 'Riquadro Rete', helper: 'Riquadro in alto a destra: Import/Export rete + totali giornalieri. Posizione e dimensioni.' },
          pvBox: { title: 'Riquadro PV', helper: 'Riquadro in alto a sinistra: PV Totale (somma array) + Produzione giornaliera. Posizione e dimensioni.' },
          batteryFill: { title: 'Posizione Fill Batteria', helper: 'I cursori mostrano coordinate (px) e angoli (°) esatti. Annota i valori per la YAML definitiva. YAML: dev_battery_fill_x, _y_base, _width, _max_height, _rotate, _skew_x, _skew_y.' },
          overlay_image: { title: 'Immagine Overlay', helper: '⚠️ FUNZIONE PRO: Aggiungi fino a 5 immagini PNG personalizzate sovrapposte alla card (auto, piscine, turbine, ecc.). Ogni immagine ha controlli indipendenti per posizione (X/Y), dimensione (larghezza/altezza) e opacità. Perfetto per aggiungere elementi visivi realistici al tuo dashboard energetico. Esempi inclusi: car.png, car_real.png, Pool.png, pool_real.png, turbine.png. Per sbloccare: invia 1€ a PayPal (3dprint8616@gmail.com) con la tua email.' },
          custom_flows: { title: 'Flussi Personalizzati', helper: 'Crea fino a 5 flussi di energia animati aggiuntivi con sensori, percorsi SVG, colori e soglie di attivazione personalizzati. Ogni flusso può avere posizioni sorgente/destinazione indipendenti, colori linea, effetti glow e soglie di potenza. Perfetto per visualizzare carichi personalizzati (pompa piscina, pompa di calore, caricatore EV, ecc.) o sorgenti energetiche aggiuntive. I flussi si animano automaticamente quando i valori del sensore superano la soglia.' },
          custom_text: { title: 'Testo Personalizzato', helper: 'Aggiungi fino a 5 etichette di testo personalizzate ovunque sulla card. Ogni testo può mostrare: etichette statiche, valori sensore (con unità), o entrambi combinati. Configura posizione (X/Y), colore, dimensione carattere e formato. Perfetto per mostrare dati aggiuntivi come temperature, umidità, consumo energetico o messaggi di stato personalizzati sul tuo dashboard energetico.' },
          about: { title: 'Informazioni', helper: 'Crediti, versione e link utili.' }
        },
        fields: {
          card_title: { label: 'Titolo scheda', helper: 'Titolo mostrato nella parte superiore della scheda. Lasciare vuoto per disabilitare.' },
          overlay_image_enabled: { label: 'Abilita immagine overlay 1', helper: 'Abilita o disabilita la prima immagine overlay. Attiva/disattiva per mostrare/nascondere l\'immagine sulla card.' },
          overlay_image: { label: 'Percorso immagine overlay 1', helper: 'Percorso della tua immagine PNG. Esempio predefinito: /local/community/lumina-energy-card/car.png. Carica immagini personalizzate in /config/www/ e referenziale come /local/nomefile.png. Supporta PNG trasparenti per effetti overlay realistici.' },
          overlay_image_x: { label: 'Posizione X immagine overlay 1 (px)', helper: 'Posizione orizzontale dal bordo sinistro. Usa valori negativi per spostare a sinistra, positivi per destra. Regola in tempo reale usando l\'editor visuale. Range: -800 a 1600. Predefinito: 0.' },
          overlay_image_y: { label: 'Posizione Y immagine overlay 1 (px)', helper: 'Posizione verticale dal bordo superiore. Usa valori negativi per spostare in alto, positivi in basso. Regola in tempo reale usando l\'editor visuale. Range: -450 a 900. Predefinito: 0.' },
          overlay_image_width: { label: 'Larghezza immagine overlay 1 (px)', helper: 'Larghezza dell\'immagine in pixel. Regola per scalare l\'immagine proporzionalmente con l\'altezza. Consiglio: mantieni le proporzioni per risultati visivi ottimali. Predefinito: 800.' },
          overlay_image_height: { label: 'Altezza immagine overlay 1 (px)', helper: 'Altezza dell\'immagine in pixel. Regola per scalare l\'immagine proporzionalmente con la larghezza. Consiglio: mantieni le proporzioni per risultati visivi ottimali. Predefinito: 450.' },
          overlay_image_opacity: { label: 'Opacità immagine overlay 1', helper: 'Livello di trasparenza: 0.0 = completamente trasparente (invisibile), 1.0 = completamente opaco (solido). Usa valori come 0.5 per effetti overlay semi-trasparenti. Predefinito: 1.0.' },
          overlay_image_2_enabled: { label: 'Abilita immagine overlay 2', helper: 'Abilita o disabilita la seconda immagine overlay. Sovrapponi più immagini per visualizzazioni complesse.' },
          overlay_image_2: { label: 'Percorso immagine overlay 2', helper: 'Percorso seconda immagine PNG. Esempio predefinito: /local/community/lumina-energy-card/car_real.png. Sovrapponi più immagini per creare scene realistiche con elementi diversi.' },
          overlay_image_2_x: { label: 'Posizione X immagine overlay 2 (px)', helper: 'Posizione orizzontale della seconda immagine overlay. Predefinito: 0.' },
          overlay_image_2_y: { label: 'Posizione Y immagine overlay 2 (px)', helper: 'Posizione verticale della seconda immagine overlay. Predefinito: 0.' },
          overlay_image_2_width: { label: 'Larghezza immagine overlay 2 (px)', helper: 'Larghezza della seconda immagine overlay. Predefinito: 800.' },
          overlay_image_2_height: { label: 'Altezza immagine overlay 2 (px)', helper: 'Altezza della seconda immagine overlay. Predefinito: 450.' },
          overlay_image_2_opacity: { label: 'Opacità immagine overlay 2', helper: 'Opacità della seconda immagine overlay (0.0 a 1.0). Predefinito: 1.0.' },
          overlay_image_3_enabled: { label: 'Abilita immagine overlay 3', helper: 'Abilita o disabilita la terza immagine overlay. Aggiungi più elementi visivi al tuo dashboard energetico.' },
          overlay_image_3: { label: 'Percorso immagine overlay 3', helper: 'Percorso terza immagine PNG. Esempio predefinito: /local/community/lumina-energy-card/Pool.png. Perfetto per mostrare piscine, scaldabagni o altri consumatori energetici.' },
          overlay_image_3_x: { label: 'Posizione X immagine overlay 3 (px)', helper: 'Posizione orizzontale della terza immagine overlay. Predefinito: 0.' },
          overlay_image_3_y: { label: 'Posizione Y immagine overlay 3 (px)', helper: 'Posizione verticale della terza immagine overlay. Predefinito: 0.' },
          overlay_image_3_width: { label: 'Larghezza immagine overlay 3 (px)', helper: 'Larghezza della terza immagine overlay. Predefinito: 800.' },
          overlay_image_3_height: { label: 'Altezza immagine overlay 3 (px)', helper: 'Altezza della terza immagine overlay. Predefinito: 450.' },
          overlay_image_3_opacity: { label: 'Opacità immagine overlay 3', helper: 'Opacità della terza immagine overlay (0.0 a 1.0). Predefinito: 1.0.' },
          overlay_image_4_enabled: { label: 'Abilita immagine overlay 4', helper: 'Abilita o disabilita la quarta immagine overlay. Combina più overlay per visualizzazioni dettagliate.' },
          overlay_image_4: { label: 'Percorso immagine overlay 4', helper: 'Percorso quarta immagine PNG. Esempio predefinito: /local/community/lumina-energy-card/pool_real.png. Usa immagini realistiche o stilizzate in base alle tue preferenze.' },
          overlay_image_4_x: { label: 'Posizione X immagine overlay 4 (px)', helper: 'Posizione orizzontale della quarta immagine overlay. Predefinito: 0.' },
          overlay_image_4_y: { label: 'Posizione Y immagine overlay 4 (px)', helper: 'Posizione verticale della quarta immagine overlay. Predefinito: 0.' },
          overlay_image_4_width: { label: 'Larghezza immagine overlay 4 (px)', helper: 'Larghezza della quarta immagine overlay. Predefinito: 800.' },
          overlay_image_4_height: { label: 'Altezza immagine overlay 4 (px)', helper: 'Altezza della quarta immagine overlay. Predefinito: 450.' },
          overlay_image_4_opacity: { label: 'Opacità immagine overlay 4', helper: 'Opacità della quarta immagine overlay (0.0 a 1.0). Predefinito: 1.0.' },
          overlay_image_5_enabled: { label: 'Abilita immagine overlay 5', helper: 'Abilita o disabilita la quinta immagine overlay. Massima flessibilità con 5 livelli overlay indipendenti.' },
          overlay_image_5: { label: 'Percorso immagine overlay 5', helper: 'Percorso quinta immagine PNG. Esempio predefinito: /local/community/lumina-energy-card/turbine.png. Ottimo per turbine eoliche, pannelli solari, generatori o qualsiasi fonte di energia rinnovabile.' },
          overlay_image_5_x: { label: 'Posizione X immagine overlay 5 (px)', helper: 'Posizione orizzontale della quinta immagine overlay. Predefinito: 0.' },
          overlay_image_5_y: { label: 'Posizione Y immagine overlay 5 (px)', helper: 'Posizione verticale della quinta immagine overlay. Predefinito: 0.' },
          overlay_image_5_width: { label: 'Larghezza immagine overlay 5 (px)', helper: 'Larghezza della quinta immagine overlay. Predefinito: 800.' },
          overlay_image_5_height: { label: 'Altezza immagine overlay 5 (px)', helper: 'Altezza della quinta immagine overlay. Predefinito: 450.' },
          overlay_image_5_opacity: { label: 'Opacità immagine overlay 5', helper: 'Opacità della quinta immagine overlay (0.0 a 1.0). Predefinito: 1.0.' },
          language: { label: 'Lingua', helper: 'Seleziona la lingua dell editor.' },
          display_unit: { label: 'Unita di visualizzazione', helper: 'Unita usata per i valori di potenza.' },
          update_interval: { label: 'Intervallo di aggiornamento', helper: 'Frequenza di aggiornamento della scheda (0 disattiva il limite).' },
          animation_speed_factor: { label: 'Fattore velocita animazioni', helper: 'Regola il moltiplicatore (-3x a 3x). Usa 0 per mettere in pausa; valori negativi invertono il flusso.' },
          animation_style: { label: 'Stile animazione', helper: 'Scegli il motivo dei flussi (tratteggi, punti, frecce o shimmer).' },
          flow_stroke_width: { label: 'Larghezza tratto flusso (px)', helper: 'Override opzionale per la larghezza del tratto animato (nessuna modifica SVG). Lascia vuoto per mantenere i default SVG.' },
          // Custom Flow Paths (SVG path strings)
          pv1_flow_path: { label: 'PV1 Percorso Flusso (SVG)', helper: `Stringa SVG personalizzata per il percorso PV1. Lascia vuoto per usare il default. Default: ${FLOW_PATHS.pv1}` },
          pv2_flow_path: { label: 'PV2 Percorso Flusso (SVG)', helper: `Stringa SVG personalizzata per il percorso PV2. Lascia vuoto per usare il default. Default: ${FLOW_PATHS.pv2}` },
          bat_flow_path: { label: 'Batteria Percorso Flusso (SVG)', helper: `Stringa SVG personalizzata per il percorso batteria. Lascia vuoto per usare il default. Default: ${FLOW_PATHS.bat}` },
          load_flow_path: { label: 'Carico Percorso Flusso (SVG)', helper: `Stringa SVG personalizzata per il percorso carico. Lascia vuoto per usare il default. Default: ${FLOW_PATHS.load}` },
          grid_flow_path: { label: 'Rete Percorso Flusso (SVG)', helper: `Stringa SVG personalizzata per il percorso rete. Lascia vuoto per usare il default. Default: ${FLOW_PATHS.grid}` },
          grid_house_flow_path: { label: 'Rete-Casa Percorso Flusso (SVG)', helper: `Stringa SVG personalizzata per il percorso rete-casa. Lascia vuoto per usare il default. Default: ${FLOW_PATHS.grid_house}` },
          car1_flow_path: { label: 'Auto1 Percorso Flusso (SVG)', helper: `Stringa SVG personalizzata per il percorso Auto1. Lascia vuoto per usare il default. Default: ${FLOW_PATHS.car1}` },
          car2_flow_path: { label: 'Auto2 Percorso Flusso (SVG)', helper: `Stringa SVG personalizzata per il percorso Auto2. Lascia vuoto per usare il default. Default: ${FLOW_PATHS.car2}` },
          heat_pump_flow_path: { label: 'Pompa di calore Percorso Flusso (SVG)', helper: `Stringa SVG personalizzata per il percorso pompa di calore. Lascia vuoto per usare il default. Default: ${FLOW_PATHS.heatPump}` },
          
          sensor_pv_total: { label: 'Sensore PV totale', helper: 'Sensore aggregato opzionale mostrato come linea combinata.' },
          sensor_pv_total_secondary: { label: 'Sensore PV totale (Inverter 2)', helper: 'Secondo sensore inverter opzionale; viene sommato al totale PV.' },
          sensor_pv1: { label: 'PV String 1 (Array 1)', helper: 'Sensore principale di produzione solare.' },
          sensor_pv2: { label: 'PV String 2 (Array 1)' },
          sensor_pv3: { label: 'PV String 3 (Array 1)' },
          sensor_pv4: { label: 'PV String 4 (Array 1)' },
          sensor_pv5: { label: 'PV String 5 (Array 1)' },
          sensor_pv6: { label: 'PV String 6 (Array 1)' },
          show_pv_strings: { label: 'Mostra stringhe PV', helper: 'Attiva per mostrare la linea totale piu ogni stringa PV separata.' },
          sensor_daily: { label: 'Sensore produzione giornaliera (Obbligatorio)', helper: 'Sensore che riporta la produzione giornaliera. Come minimo deve essere specificato il sensore PV totale oppure gli array di stringhe PV.' },
          sensor_daily_array2: { label: 'Sensore produzione giornaliera (Array 2)', helper: 'Sensore che riporta la produzione giornaliera per l Array 2.' },
          sensor_bat1_soc: { label: 'Batteria 1 SOC' },
          sensor_bat1_power: { label: 'Batteria 1 potenza' },
          sensor_bat2_soc: { label: 'Batteria 2 SOC' },
          sensor_bat2_power: { label: 'Batteria 2 potenza' },
          sensor_bat3_soc: { label: 'Batteria 3 SOC' },
          sensor_bat3_power: { label: 'Batteria 3 potenza' },
          sensor_bat4_soc: { label: 'Batteria 4 SOC' },
          sensor_bat4_power: { label: 'Batteria 4 potenza' },
          battery_power_mode: { label: 'Modalità potenza batteria', helper: 'Flow: sensore unico con segno (+ = carica → batteria, - = scarica → inverter). Carica+Scarica: sensori separati; carica = flusso verso batteria, scarica = flusso verso inverter.' },
          sensor_battery_flow: { label: 'Batteria Flow (con segno)', helper: 'Opzionale. Sensore potenza unico: positivo = carica (flusso verso batteria), negativo = scarica (flusso verso inverter). Usato in modalità Flow. Se vuoto, si usano Bat 1–4 Potenza.' },
          sensor_battery_charge: { label: 'Batteria carica', helper: 'Sensore potenza in carica. Flusso verso batteria. Usato in modalità Carica+Scarica.' },
          sensor_battery_discharge: { label: 'Batteria scarica', helper: 'Sensore potenza in scarica. Flusso verso inverter. Usato in modalità Carica+Scarica.' },
          sensor_home_load: { label: 'Carico casa/consumo (Obbligatorio)', helper: 'Sensore del consumo totale dell abitazione.' },
          sensor_home_load_secondary: { label: 'Carico casa (Inverter 2)', helper: 'Sensore opzionale del carico domestico per il secondo inverter.' },
          sensor_heat_pump_consumption: { label: 'Consumo pompa di calore', helper: 'Sensore per il consumo energetico della pompa di calore.' },
          sensor_house_temperature: { label: 'Sensore temperatura casa', helper: 'Sensore di temperatura visualizzato sulla casa con effetto odometro hi-tech.' },
          house_temperature_offset_x: { label: 'Offset X Temperatura', helper: 'Offset orizzontale per la visualizzazione della temperatura (in pixel).' },
          house_temperature_offset_y: { label: 'Offset Y Temperatura', helper: 'Offset verticale per la visualizzazione della temperatura (in pixel).' },
          house_temperature_rotation: { label: 'Rotazione Temperatura', helper: 'Angolo di rotazione per la visualizzazione della temperatura (in gradi, da -360 a 360).' },
          sensor_grid_power: { label: 'Potenza rete', helper: 'Sensore flusso rete positivo/negativo. Specificare o questo sensore o entrambi il Sensore import rete e il Sensore export rete.' },
          sensor_grid_import: { label: 'Sensore import rete', helper: 'Entita opzionale che riporta la potenza di import.' },
          sensor_grid_export: { label: 'Sensore export rete', helper: 'Entita opzionale che riporta la potenza di export.' },
          sensor_grid_import_daily: { label: 'Sensore import rete giornaliero', helper: 'Entita opzionale che riporta l import cumulativo della rete per il giorno corrente.' },
          sensor_grid_export_daily: { label: 'Sensore export rete giornaliero', helper: 'Entita opzionale che riporta l export cumulativo della rete per il giorno corrente.' },
          pv_primary_color: { label: 'Colore flusso FV 1', helper: 'Colore utilizzato per l animazione FV principale.' },
          pv_tot_color: { label: 'Colore PV TOTALE', helper: 'Colore applicato alla riga PV TOTALE.' },
          pv_secondary_color: { label: 'Colore flusso FV 2', helper: 'Colore utilizzato per la seconda linea FV quando presente.' },
          pv_text_color: { label: 'Colore testo FV', helper: 'Colore per le etichette FV (Array 1).' },
          pv_font_size: { label: 'Dimensione font FV (px)', helper: 'Dimensione font per il testo FV (Array 1).' },
          pv_secondary_text_color: { label: 'Colore testo Array 2', helper: 'Colore per le etichette Array 2.' },
          pv_secondary_font_size: { label: 'Dimensione font Array 2 (px)', helper: 'Dimensione font per il testo Array 2.' },
          pv_string1_color: { label: 'Colore stringa FV 1', helper: 'Sovrascrive il colore di S1. Lascia vuoto per usare il colore totale FV.' },
          pv_string2_color: { label: 'Colore stringa FV 2', helper: 'Sovrascrive il colore di S2. Lascia vuoto per usare il colore totale FV.' },
          pv_string3_color: { label: 'Colore stringa FV 3', helper: 'Sovrascrive il colore di S3. Lascia vuoto per usare il colore totale FV.' },
          pv_string4_color: { label: 'Colore stringa FV 4', helper: 'Sovrascrive il colore di S4. Lascia vuoto per usare il colore totale FV.' },
          pv_string5_color: { label: 'Colore stringa FV 5', helper: 'Sovrascrive il colore di S5. Lascia vuoto per usare il colore totale FV.' },
          pv_string6_color: { label: 'Colore stringa FV 6', helper: 'Sovrascrive il colore di S6. Lascia vuoto per usare il colore totale FV.' },
          load_flow_color: { label: 'Colore flusso carico', helper: 'Colore applicato all animazione del carico della casa.' },
          load_text_color: { label: 'Colore testo carico', helper: 'Colore applicato al testo del carico di casa quando le soglie non sono attive.' },
          inv1_color: { label: 'Colore INV 1', helper: 'Colore applicato al testo/flusso INV 1.' },
          inv2_color: { label: 'Colore INV 2', helper: 'Colore applicato al testo/flusso INV 2.' },
          load_threshold_warning: { label: 'Soglia avviso carico', helper: 'Cambia colore quando il carico raggiunge questa soglia. Usa l unita di visualizzazione selezionata.' },
          load_warning_color: { label: 'Colore avviso carico', helper: 'Colore applicato alla soglia di avviso del carico.' },
          load_threshold_critical: { label: 'Soglia critica carico', helper: 'Cambia colore quando il carico raggiunge questa soglia critica. Usa l unita di visualizzazione selezionata.' },
          load_critical_color: { label: 'Colore critico carico', helper: 'Colore applicato alla soglia critica del carico.' },
          battery_soc_color: { label: 'Colore SOC batteria', helper: 'Colore applicato al testo percentuale SOC della batteria.' },
          battery_charge_color: { label: 'Colore flusso carica batteria', helper: 'Colore quando l energia entra nella batteria.' },
          battery_discharge_color: { label: 'Colore flusso scarica batteria', helper: 'Colore quando l energia esce dalla batteria.' },
          grid_import_color: { label: 'Colore import da rete', helper: 'Colore base (prima delle soglie) quando si importa dalla rete.' },
          grid_export_color: { label: 'Colore export verso rete', helper: 'Colore base (prima delle soglie) quando si esporta verso la rete.' },
          car_flow_color: { label: 'Colore flusso EV', helper: 'Colore applicato all animazione del veicolo elettrico.' },
          battery_fill_opacity: { label: 'Opacità fill batteria', helper: 'Trasparenza del liquido batteria (0,05–1).' },
          grid_activity_threshold: { label: 'Soglia animazione rete (W)', helper: 'Ignora i flussi rete con magnitudine inferiore a questo valore prima di animarli.' },
          grid_threshold_warning: { label: 'Soglia avviso rete', helper: 'Cambia colore quando la magnitudine raggiunge questa soglia. Usa l unita di visualizzazione selezionata.' },
          grid_warning_color: { label: 'Colore avviso rete', helper: 'Colore applicato alla soglia di avviso.' },
          grid_threshold_critical: { label: 'Soglia critica rete', helper: 'Cambia colore quando la magnitudine raggiunge questa soglia. Usa l unita di visualizzazione selezionata.' },
          grid_critical_color: { label: 'Colore critico rete', helper: 'Colore applicato alla soglia critica.' },
            invert_grid: { label: 'Inverti valori rete', helper: 'Attiva se l import/export ha polarita invertita.' },
            enable_echo_alive: { label: 'Abilita Echo Alive', helper: 'Abilita un iframe invisibile per mantenere aperto il browser Silk su Echo Show. Il pulsante sarà posizionato in un angolo della card.' },
            enable_text_toggle_button: { label: 'Abilita Pulsante Toggle Testi', helper: 'Mostra un pulsante sulla card per attivare/disattivare la visibilità dei testi.' },
            text_toggle_button_x: { label: 'Pulsante Toggle Testi X (px)', helper: 'Posizione orizzontale del pulsante toggle testi. Distanza dal bordo sinistro in pixel. Default: 10px (basso-sinistra).' },
            text_toggle_button_y: { label: 'Pulsante Toggle Testi Y (px)', helper: 'Posizione verticale dall\'alto in pixel (0-450). Lascia vuoto o imposta > 450 per posizionare in basso. Valori > 450 verranno trattati come posizionamento in basso. Default: basso.' },
            text_toggle_button_scale: { label: 'Scala Pulsante Toggle Testi', helper: 'Fattore di scala per la dimensione del pulsante (0.5 a 2.0). 1.0 = dimensione predefinita.' },
            text_visibility_sensor: { label: 'Sensore Movimento Visibilità Testi (PRO)', helper: '⚠️ FUNZIONE PRO: Entità sensore di movimento. Quando viene rilevato movimento, i testi appaiono. Perfetto per tablet a muro con telecamera.' },
            solar_forecast_enabled: { label: 'Abilita Previsione Solare', helper: '⚠️ FUNZIONE PRO: Mostra la produzione solare stimata con stato del sole (tanto/moderato/poco sole).' },
            sensor_solar_forecast: { label: 'Sensore Previsione Solare', helper: 'Entità sensore per la produzione solare stimata (in W o kW).' },
            solar_forecast_max_power: { label: 'Potenza Massima Previsione Solare (W)', helper: 'Potenza massima attesa in watt. Usata per calcolare la percentuale per lo stato del sole (predefinito: 10000W).' },
            solar_forecast_x: { label: 'Posizione X Previsione Solare (px)', helper: 'Posizione orizzontale del testo previsione solare (in pixel).' },
            solar_forecast_y: { label: 'Posizione Y Previsione Solare (px)', helper: 'Posizione verticale del testo previsione solare (in pixel).' },
            solar_forecast_color: { label: 'Colore Previsione Solare', helper: 'Colore per il testo previsione solare (predefinito: #00FFFF).' },
            solar_forecast_size: { label: 'Dimensione Font Previsione Solare (px)', helper: 'Dimensione font per il testo previsione solare (predefinito: 16px).' },
            invert_battery: { label: 'Inverti valori batteria', helper: 'Abilita se la polarita carica/scarica e invertita.' },
          sensor_car_power: { label: 'Sensore potenza auto 1' },
          sensor_car_soc: { label: 'Sensore SOC auto 1' },
          car_soc: { label: 'SOC Auto', helper: 'Sensore per SOC batteria EV.' },
          car_range: { label: 'Autonomia Auto', helper: 'Sensore per autonomia EV.' },
          car_efficiency: { label: 'Efficienza Auto', helper: 'Sensore per efficienza EV.' },
          car_charger_power: { label: 'Potenza Caricabatterie Auto', helper: 'Sensore per potenza caricabatterie EV.' },
          car1_label: { label: 'Etichetta Auto 1', helper: 'Testo mostrato vicino ai valori della prima EV.' },
          sensor_car2_power: { label: 'Sensore potenza auto 2' },
          car2_power: { label: 'Potenza Auto 2', helper: 'Sensore per potenza carica/scarica EV 2.' },
          sensor_car2_soc: { label: 'Sensore SOC auto 2' },
          car2_soc: { label: 'SOC Auto 2', helper: 'Sensore per SOC batteria EV 2.' },
          car2_range: { label: 'Autonomia Auto 2', helper: 'Sensore per autonomia EV 2.' },
          car2_efficiency: { label: 'Efficienza Auto 2', helper: 'Sensore per efficienza EV 2.' },
          car2_charger_power: { label: 'Potenza Caricabatterie Auto 2', helper: 'Sensore per potenza caricabatterie EV 2.' },
          car2_label: { label: 'Etichetta Auto 2', helper: 'Testo mostrato vicino ai valori della seconda EV.' },
          show_car_soc: { label: 'Mostra veicolo elettrico 1', helper: 'Attiva per visualizzare i dati della prima EV.' },
          show_car2: { label: 'Mostra veicolo elettrico 2', helper: 'Attiva e fornisci i sensori per visualizzare la seconda EV.' },
            car1_bidirectional: { label: 'Capacità bidirezionale Auto 1', helper: 'Abilita se l\'Auto 1 ha capacità V2X (può caricare e scaricare come una batteria domestica).' },
            car2_bidirectional: { label: 'Capacità bidirezionale Auto 2', helper: 'Abilita se l\'Auto 2 ha capacità V2X (può caricare e scaricare come una batteria domestica).' },
            car1_invert_flow: { label: 'Inverti Flusso Auto 1', helper: 'Inverte la direzione del flusso per l\'Auto 1. Utile se la polarità del sensore è invertita.' },
            car2_invert_flow: { label: 'Inverti Flusso Auto 2', helper: 'Inverte la direzione del flusso per l\'Auto 2. Utile se la polarità del sensore è invertita.' },
            array1_invert_flow: { label: 'Inverti Flusso Array 1', helper: 'Inverte la direzione del flusso per l\'Array 1 (PV1). Utile se la polarità del sensore è invertita.' },
            array2_invert_flow: { label: 'Inverti Flusso Array 2', helper: 'Inverte la direzione del flusso per l\'Array 2 (PV2). Utile se la polarità del sensore è invertita.' },
          car_pct_color: { label: 'Colore SOC auto', helper: 'Colore esadecimale per il testo SOC EV (es. #00FFFF).' },
          car2_pct_color: { label: 'Colore SOC Auto 2', helper: 'Colore esadecimale per il testo SOC della seconda EV (usa Car SOC se vuoto).' },
          car1_name_color: { label: 'Colore nome Auto 1', helper: 'Colore applicato all etichetta del nome Auto 1.' },
          car2_name_color: { label: 'Colore nome Auto 2', helper: 'Colore applicato all etichetta del nome Auto 2.' },
          car1_color: { label: 'Colore Auto 1', helper: 'Colore applicato al valore potenza Auto 1.' },
          car2_color: { label: 'Colore Auto 2', helper: 'Colore applicato al valore potenza Auto 2.' },
          pro_password: { label: 'Password PRO', helper: '⚠️ FUNZIONE PRO: Questa è una funzione premium.' },
          paypal_button: 'Sblocca Funzioni PRO (1€)',
          paypal_note: 'IMPORTANTE: Invia SOLO come DONAZIONE. NON usare pagamento beni e servizi. Inserisci la tua EMAIL nelle note PayPal per ricevere la password.',
          overlay_image_enabled: { label: 'Abilita immagine overlay', helper: 'Abilita o disabilita l immagine overlay personalizzata (richiede autorizzazione PRO).' },
          heat_pump_flow_color: { label: 'Colore flusso pompa di calore', helper: 'Colore applicato all animazione del flusso della pompa di calore.' },
          heat_pump_text_color: { label: 'Colore testo pompa di calore', helper: 'Colore applicato al testo della potenza della pompa di calore.' },
          text_font_size: { label: 'Dimensione font testi (px)', helper: 'Dimensione font unificata per tutti i testi (Solar, Batteria, Rete, Auto, Pompa di calore, Casa). Predefinita: 12px.' },
          header_font_size: { label: 'Dimensione titolo (px)', helper: 'Predefinita 16' },
          daily_label_font_size: { label: 'Dimensione etichetta giornaliera (px)', helper: 'Predefinita 12' },
          daily_value_font_size: { label: 'Dimensione valore giornaliero (px)', helper: 'Predefinita 20' },
          pv_font_size: { label: 'Dimensione testo PV (px)', helper: 'Predefinita 16' },
          battery_soc_font_size: { label: 'Dimensione SOC batteria (px)', helper: 'Predefinita 20' },
          battery_power_font_size: { label: 'Dimensione potenza batteria (px)', helper: 'Predefinita 16' },
          load_font_size: { label: 'Dimensione carico (px)', helper: 'Predefinita 15' },
          heat_pump_font_size: { label: 'Dimensione pompa di calore (px)', helper: 'Predefinita 16' },
          grid_font_size: { label: 'Dimensione rete (px)', helper: 'Predefinita 15' },
          car_power_font_size: { label: 'Dimensione potenza auto (px)', helper: 'Predefinita 15' },
          car2_power_font_size: { label: 'Dimensione potenza Auto 2 (px)', helper: 'Predefinita 15' },
          car_name_font_size: { label: 'Dimensione nome auto (px)', helper: 'Predefinita come la dimensione potenza auto' },
          car2_name_font_size: { label: 'Dimensione nome Auto 2 (px)', helper: 'Predefinita come la dimensione potenza Auto 2' },
          car_soc_font_size: { label: 'Dimensione SOC auto (px)', helper: 'Predefinita 12' },
          car2_soc_font_size: { label: 'Dimensione SOC Auto 2 (px)', helper: 'Predefinita 12' },
          sensor_popup_pv_1: { label: 'PV Popup 1', helper: 'Entita per la riga 1 del popup PV.' },
          sensor_popup_pv_2: { label: 'PV Popup 2', helper: 'Entita per la riga 2 del popup PV.' },
          sensor_popup_pv_3: { label: 'PV Popup 3', helper: 'Entita per la riga 3 del popup PV.' },
          sensor_popup_pv_4: { label: 'PV Popup 4', helper: 'Entita per la riga 4 del popup PV.' },
          sensor_popup_pv_5: { label: 'PV Popup 5', helper: 'Entita per la riga 5 del popup PV.' },
          sensor_popup_pv_6: { label: 'PV Popup 6', helper: 'Entita per la riga 6 del popup PV.' },
          sensor_popup_pv_1_name: { label: 'Nome PV Popup 1', helper: 'Nome personalizzato opzionale per la riga 1 del popup PV. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_pv_2_name: { label: 'Nome PV Popup 2', helper: 'Nome personalizzato opzionale per la riga 2 del popup PV. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_pv_3_name: { label: 'Nome PV Popup 3', helper: 'Nome personalizzato opzionale per la riga 3 del popup PV. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_pv_4_name: { label: 'Nome PV Popup 4', helper: 'Nome personalizzato opzionale per la riga 4 del popup PV. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_pv_5_name: { label: 'Nome PV Popup 5', helper: 'Nome personalizzato opzionale per la riga 5 del popup PV. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_pv_6_name: { label: 'Nome PV Popup 6', helper: 'Nome personalizzato opzionale per la riga 6 del popup PV. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_pv_1_color: { label: 'Colore PV Popup 1', helper: 'Colore per il testo della riga 1 del popup PV.' },
          sensor_popup_pv_2_color: { label: 'Colore PV Popup 2', helper: 'Colore per il testo della riga 2 del popup PV.' },
          sensor_popup_pv_3_color: { label: 'Colore PV Popup 3', helper: 'Colore per il testo della riga 3 del popup PV.' },
          sensor_popup_pv_4_color: { label: 'Colore PV Popup 4', helper: 'Colore per il testo della riga 4 del popup PV.' },
          sensor_popup_pv_5_color: { label: 'Colore PV Popup 5', helper: 'Colore per il testo della riga 5 del popup PV.' },
          sensor_popup_pv_6_color: { label: 'Colore PV Popup 6', helper: 'Colore per il testo della riga 6 del popup PV.' },
          sensor_popup_pv_1_font_size: { label: 'Dimensione carattere PV Popup 1 (px)', helper: 'Dimensione carattere per la riga 1 del popup PV. Predefinita 16' },
          sensor_popup_pv_2_font_size: { label: 'Dimensione carattere PV Popup 2 (px)', helper: 'Dimensione carattere per la riga 2 del popup PV. Predefinita 16' },
          sensor_popup_pv_3_font_size: { label: 'Dimensione carattere PV Popup 3 (px)', helper: 'Dimensione carattere per la riga 3 del popup PV. Predefinita 16' },
          sensor_popup_pv_4_font_size: { label: 'Dimensione carattere PV Popup 4 (px)', helper: 'Dimensione carattere per la riga 4 del popup PV. Predefinita 16' },
          sensor_popup_pv_5_font_size: { label: 'Dimensione carattere PV Popup 5 (px)', helper: 'Dimensione carattere per la riga 5 del popup PV. Predefinita 16' },
          sensor_popup_pv_6_font_size: { label: 'Dimensione carattere PV Popup 6 (px)', helper: 'Dimensione carattere per la riga 6 del popup PV. Predefinita 16' },
          sensor_popup_house_1: { label: 'Popup Casa 1', helper: 'Entita per la riga 1 del popup casa.' },
          sensor_popup_house_1_name: { label: 'Nome Popup Casa 1', helper: 'Nome personalizzato opzionale per la riga 1 del popup casa. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_house_1_color: { label: 'Colore Popup Casa 1', helper: 'Colore per il testo della riga 1 del popup casa.' },
          sensor_popup_house_1_font_size: { label: 'Dimensione carattere Popup Casa 1 (px)', helper: 'Dimensione carattere per la riga 1 del popup casa. Predefinita 16' },
          sensor_popup_house_2: { label: 'Popup Casa 2', helper: 'Entita per la riga 2 del popup casa.' },
          sensor_popup_house_2_name: { label: 'Nome Popup Casa 2', helper: 'Nome personalizzato opzionale per la riga 2 del popup casa. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_house_2_color: { label: 'Colore Popup Casa 2', helper: 'Colore per il testo della riga 2 del popup casa.' },
          sensor_popup_house_2_font_size: { label: 'Dimensione carattere Popup Casa 2 (px)', helper: 'Dimensione carattere per la riga 2 del popup casa. Predefinita 16' },
          sensor_popup_house_3: { label: 'Popup Casa 3', helper: 'Entita per la riga 3 del popup casa.' },
          sensor_popup_house_3_name: { label: 'Nome Popup Casa 3', helper: 'Nome personalizzato opzionale per la riga 3 del popup casa. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_house_3_color: { label: 'Colore Popup Casa 3', helper: 'Colore per il testo della riga 3 del popup casa.' },
          sensor_popup_house_3_font_size: { label: 'Dimensione carattere Popup Casa 3 (px)', helper: 'Dimensione carattere per la riga 3 del popup casa. Predefinita 16' },
          sensor_popup_house_4: { label: 'Popup Casa 4', helper: 'Entita per la riga 4 del popup casa.' },
          sensor_popup_house_4_name: { label: 'Nome Popup Casa 4', helper: 'Nome personalizzato opzionale per la riga 4 del popup casa. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_house_4_color: { label: 'Colore Popup Casa 4', helper: 'Colore per il testo della riga 4 del popup casa.' },
          sensor_popup_house_4_font_size: { label: 'Dimensione carattere Popup Casa 4 (px)', helper: 'Dimensione carattere per la riga 4 del popup casa. Predefinita 16' },
          sensor_popup_house_5: { label: 'Popup Casa 5', helper: 'Entita per la riga 5 del popup casa.' },
          sensor_popup_house_5_name: { label: 'Nome Popup Casa 5', helper: 'Nome personalizzato opzionale per la riga 5 del popup casa. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_house_5_color: { label: 'Colore Popup Casa 5', helper: 'Colore per il testo della riga 5 del popup casa.' },
          sensor_popup_house_5_font_size: { label: 'Dimensione carattere Popup Casa 5 (px)', helper: 'Dimensione carattere per la riga 5 del popup casa. Predefinita 16' },
          sensor_popup_house_6: { label: 'Popup Casa 6', helper: 'Entita per la riga 6 del popup casa.' },
          sensor_popup_house_6_name: { label: 'Nome Popup Casa 6', helper: 'Nome personalizzato opzionale per la riga 6 del popup casa. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_house_6_color: { label: 'Colore Popup Casa 6', helper: 'Colore per il testo della riga 6 del popup casa.' },
          sensor_popup_house_6_font_size: { label: 'Dimensione carattere Popup Casa 6 (px)', helper: 'Dimensione carattere per la riga 6 del popup casa. Predefinita 16' },
          sensor_popup_bat_1: { label: 'Battery Popup 1', helper: 'Entità per la riga 1 del popup batteria.' },
          sensor_popup_bat_1_name: { label: 'Nome Battery Popup 1', helper: 'Nome personalizzato opzionale per la riga 1 del popup batteria. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_bat_1_color: { label: 'Colore Battery Popup 1', helper: 'Colore per il testo della riga 1 del popup batteria.' },
          sensor_popup_bat_1_font_size: { label: 'Dimensione carattere Battery Popup 1 (px)', helper: 'Dimensione carattere per la riga 1 del popup batteria. Predefinita 16' },
          sensor_popup_bat_2: { label: 'Battery Popup 2', helper: 'Entità per la riga 2 del popup batteria.' },
          sensor_popup_bat_2_name: { label: 'Nome Battery Popup 2', helper: 'Nome personalizzato opzionale per la riga 2 del popup batteria. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_bat_2_color: { label: 'Colore Battery Popup 2', helper: 'Colore per il testo della riga 2 del popup batteria.' },
          sensor_popup_bat_2_font_size: { label: 'Dimensione carattere Battery Popup 2 (px)', helper: 'Dimensione carattere per la riga 2 del popup batteria. Predefinita 16' },
          sensor_popup_bat_3: { label: 'Battery Popup 3', helper: 'Entità per la riga 3 del popup batteria.' },
          sensor_popup_bat_3_name: { label: 'Nome Battery Popup 3', helper: 'Nome personalizzato opzionale per la riga 3 del popup batteria. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_bat_3_color: { label: 'Colore Battery Popup 3', helper: 'Colore per il testo della riga 3 del popup batteria.' },
          sensor_popup_bat_3_font_size: { label: 'Dimensione carattere Battery Popup 3 (px)', helper: 'Dimensione carattere per la riga 3 del popup batteria. Predefinita 16' },
          sensor_popup_bat_4: { label: 'Battery Popup 4', helper: 'Entità per la riga 4 del popup batteria.' },
          sensor_popup_bat_4_name: { label: 'Nome Battery Popup 4', helper: 'Nome personalizzato opzionale per la riga 4 del popup batteria. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_bat_4_color: { label: 'Colore Battery Popup 4', helper: 'Colore per il testo della riga 4 del popup batteria.' },
          sensor_popup_bat_4_font_size: { label: 'Dimensione carattere Battery Popup 4 (px)', helper: 'Dimensione carattere per la riga 4 del popup batteria. Predefinita 16' },
          sensor_popup_bat_5: { label: 'Battery Popup 5', helper: 'Entità per la riga 5 del popup batteria.' },
          sensor_popup_bat_5_name: { label: 'Nome Battery Popup 5', helper: 'Nome personalizzato opzionale per la riga 5 del popup batteria. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_bat_5_color: { label: 'Colore Battery Popup 5', helper: 'Colore per il testo della riga 5 del popup batteria.' },
          sensor_popup_bat_5_font_size: { label: 'Dimensione carattere Battery Popup 5 (px)', helper: 'Dimensione carattere per la riga 5 del popup batteria. Predefinita 16' },
          sensor_popup_bat_6: { label: 'Battery Popup 6', helper: 'Entità per la riga 6 del popup batteria.' },
          sensor_popup_bat_6_name: { label: 'Nome Battery Popup 6', helper: 'Nome personalizzato opzionale per la riga 6 del popup batteria. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_bat_6_color: { label: 'Colore Battery Popup 6', helper: 'Colore per il testo della riga 6 del popup batteria.' },
          sensor_popup_bat_6_font_size: { label: 'Dimensione carattere Battery Popup 6 (px)', helper: 'Dimensione carattere per la riga 6 del popup batteria. Predefinita 16' },
          sensor_popup_grid_1: { label: 'Grid Popup 1', helper: 'Entità per la riga 1 del popup rete.' },
          sensor_popup_grid_1_name: { label: 'Nome Grid Popup 1', helper: 'Nome personalizzato opzionale per la riga 1 del popup rete. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_grid_1_color: { label: 'Colore Grid Popup 1', helper: 'Colore per il testo della riga 1 del popup rete.' },
          sensor_popup_grid_1_font_size: { label: 'Dimensione carattere Grid Popup 1 (px)', helper: 'Dimensione carattere per la riga 1 del popup rete. Predefinita 16' },
          sensor_popup_grid_2: { label: 'Grid Popup 2', helper: 'Entità per la riga 2 del popup rete.' },
          sensor_popup_grid_2_name: { label: 'Nome Grid Popup 2', helper: 'Nome personalizzato opzionale per la riga 2 del popup rete. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_grid_2_color: { label: 'Colore Grid Popup 2', helper: 'Colore per il testo della riga 2 del popup rete.' },
          sensor_popup_grid_2_font_size: { label: 'Dimensione carattere Grid Popup 2 (px)', helper: 'Dimensione carattere per la riga 2 del popup rete. Predefinita 16' },
          sensor_popup_grid_3: { label: 'Grid Popup 3', helper: 'Entità per la riga 3 del popup rete.' },
          sensor_popup_grid_3_name: { label: 'Nome Grid Popup 3', helper: 'Nome personalizzato opzionale per la riga 3 del popup rete. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_grid_3_color: { label: 'Colore Grid Popup 3', helper: 'Colore per il testo della riga 3 del popup rete.' },
          sensor_popup_grid_3_font_size: { label: 'Dimensione carattere Grid Popup 3 (px)', helper: 'Dimensione carattere per la riga 3 del popup rete. Predefinita 16' },
          sensor_popup_grid_4: { label: 'Grid Popup 4', helper: 'Entità per la riga 4 del popup rete.' },
          sensor_popup_grid_4_name: { label: 'Nome Grid Popup 4', helper: 'Nome personalizzato opzionale per la riga 4 del popup rete. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_grid_4_color: { label: 'Colore Grid Popup 4', helper: 'Colore per il testo della riga 4 del popup rete.' },
          sensor_popup_grid_4_font_size: { label: 'Dimensione carattere Grid Popup 4 (px)', helper: 'Dimensione carattere per la riga 4 del popup rete. Predefinita 16' },
          sensor_popup_grid_5: { label: 'Grid Popup 5', helper: 'Entità per la riga 5 del popup rete.' },
          sensor_popup_grid_5_name: { label: 'Nome Grid Popup 5', helper: 'Nome personalizzato opzionale per la riga 5 del popup rete. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_grid_5_color: { label: 'Colore Grid Popup 5', helper: 'Colore per il testo della riga 5 del popup rete.' },
          sensor_popup_grid_5_font_size: { label: 'Dimensione carattere Grid Popup 5 (px)', helper: 'Dimensione carattere per la riga 5 del popup rete. Predefinita 16' },
          sensor_popup_grid_6: { label: 'Grid Popup 6', helper: 'Entità per la riga 6 del popup rete.' },
          sensor_popup_grid_6_name: { label: 'Nome Grid Popup 6', helper: 'Nome personalizzato opzionale per la riga 6 del popup rete. Lasciare vuoto per usare il nome entità.' },
          sensor_popup_grid_6_color: { label: 'Colore Grid Popup 6', helper: 'Colore per il testo della riga 6 del popup rete.' },
          sensor_popup_grid_6_font_size: { label: 'Dimensione carattere Grid Popup 6 (px)', helper: 'Dimensione carattere per la riga 6 del popup rete. Predefinita 16' },
          sensor_popup_inverter_1: { label: 'Inverter Popup 1', helper: 'Entita per la riga 1 del popup inverter.' },
          sensor_popup_inverter_1_name: { label: 'Nome Inverter Popup 1', helper: 'Nome personalizzato opzionale per la riga 1 del popup inverter. Lasciare vuoto per utilizzare il nome entita.' },
          sensor_popup_inverter_1_color: { label: 'Colore Inverter Popup 1', helper: 'Colore per il testo della riga 1 del popup inverter.' },
          sensor_popup_inverter_1_font_size: { label: 'Dimensione carattere Inverter Popup 1 (px)', helper: 'Dimensione carattere per la riga 1 del popup inverter. Predefinita 16' },
          sensor_popup_inverter_2: { label: 'Inverter Popup 2', helper: 'Entita per la riga 2 del popup inverter.' },
          sensor_popup_inverter_2_name: { label: 'Nome Inverter Popup 2', helper: 'Nome personalizzato opzionale per la riga 2 del popup inverter. Lasciare vuoto per utilizzare il nome entita.' },
          sensor_popup_inverter_2_color: { label: 'Colore Inverter Popup 2', helper: 'Colore per il testo della riga 2 del popup inverter.' },
          sensor_popup_inverter_2_font_size: { label: 'Dimensione carattere Inverter Popup 2 (px)', helper: 'Dimensione carattere per la riga 2 del popup inverter. Predefinita 16' },
          sensor_popup_inverter_3: { label: 'Inverter Popup 3', helper: 'Entita per la riga 3 del popup inverter.' },
          sensor_popup_inverter_3_name: { label: 'Nome Inverter Popup 3', helper: 'Nome personalizzato opzionale per la riga 3 del popup inverter. Lasciare vuoto per utilizzare il nome entita.' },
          sensor_popup_inverter_3_color: { label: 'Colore Inverter Popup 3', helper: 'Colore per il testo della riga 3 del popup inverter.' },
          sensor_popup_inverter_3_font_size: { label: 'Dimensione carattere Inverter Popup 3 (px)', helper: 'Dimensione carattere per la riga 3 del popup inverter. Predefinita 16' },
          sensor_popup_inverter_4: { label: 'Inverter Popup 4', helper: 'Entita per la riga 4 del popup inverter.' },
          sensor_popup_inverter_4_name: { label: 'Nome Inverter Popup 4', helper: 'Nome personalizzato opzionale per la riga 4 del popup inverter. Lasciare vuoto per utilizzare il nome entita.' },
          sensor_popup_inverter_4_color: { label: 'Colore Inverter Popup 4', helper: 'Colore per il testo della riga 4 del popup inverter.' },
          sensor_popup_inverter_4_font_size: { label: 'Dimensione carattere Inverter Popup 4 (px)', helper: 'Dimensione carattere per la riga 4 del popup inverter. Predefinita 16' },
          sensor_popup_inverter_5: { label: 'Inverter Popup 5', helper: 'Entita per la riga 5 del popup inverter.' },
          sensor_popup_inverter_5_name: { label: 'Nome Inverter Popup 5', helper: 'Nome personalizzato opzionale per la riga 5 del popup inverter. Lasciare vuoto per utilizzare il nome entita.' },
          sensor_popup_inverter_5_color: { label: 'Colore Inverter Popup 5', helper: 'Colore per il testo della riga 5 del popup inverter.' },
          sensor_popup_inverter_5_font_size: { label: 'Dimensione carattere Inverter Popup 5 (px)', helper: 'Dimensione carattere per la riga 5 del popup inverter. Predefinita 16' },
          sensor_popup_inverter_6: { label: 'Inverter Popup 6', helper: 'Entita per la riga 6 del popup inverter.' },
          sensor_popup_inverter_6_name: { label: 'Nome Inverter Popup 6', helper: 'Nome personalizzato opzionale per la riga 6 del popup inverter. Lasciare vuoto per utilizzare il nome entita.' },
          sensor_popup_inverter_6_color: { label: 'Colore Inverter Popup 6', helper: 'Colore per il testo della riga 6 del popup inverter.' },
          sensor_popup_inverter_6_font_size: { label: 'Dimensione carattere Inverter Popup 6 (px)', helper: 'Dimensione carattere per la riga 6 del popup inverter. Predefinita 16' },
          dev_soc_bar_x: { label: 'Barra SOC X (px)', helper: 'Posizione orizzontale. ViewBox 0–800. Path M 330,370 360,360 350,270 320,280 Z → 325.' },
          dev_soc_bar_y: { label: 'Barra SOC Y (px)', helper: 'Posizione verticale. ViewBox 0–450.' },
          dev_soc_bar_width: { label: 'Barra SOC Larghezza (px)', helper: 'Larghezza barra. Path bbox 30.' },
          dev_soc_bar_height: { label: 'Barra SOC Altezza (px)', helper: 'Altezza barra. Path bbox 85.' },
          dev_soc_bar_rotate: { label: 'Barra SOC Rotazione (°)', helper: 'Rotazione 0–360°. Usa -180…180 per il cerchio completo.' },
          dev_soc_bar_skew_x: { label: 'Barra SOC Skew X (°)', helper: 'Angolo di inclinazione orizzontale in gradi.' },
          dev_soc_bar_skew_y: { label: 'Barra SOC Skew Y (°)', helper: 'Angolo di inclinazione verticale in gradi.' },
          soc_bar_opacity: { label: 'Barra SOC Opacità', helper: 'Trasparenza 0,05–1.' },
          soc_bar_glow: { label: 'Barra SOC Alone (px)', helper: 'Sfocatura drop-shadow sui segmenti accesi. 0 = off.' },
          soc_bar_color_on: { label: 'Barra SOC Colore (acceso)', helper: 'Colore del segmento quando illuminato dal SOC.' },
          soc_bar_color_off: { label: 'Barra SOC Colore (spento)', helper: 'Colore del segmento quando non illuminato.' },
          dev_grid_box_x: { label: 'Riquadro Rete X (px)', helper: 'Riquadro in alto a destra. Import/Export + giornalieri.' },
          dev_grid_box_y: { label: 'Riquadro Rete Y (px)', helper: 'Posizione verticale.' },
          dev_grid_box_width: { label: 'Riquadro Rete Larghezza (px)', helper: '' },
          dev_grid_box_height: { label: 'Riquadro Rete Altezza (px)', helper: '' },
          dev_grid_box_font_size: { label: 'Riquadro Rete Dimensione font (px)', helper: 'Dimensione carattere per il testo nel riquadro rete. Vuoto = scalatura automatica.' },
          dev_grid_box_text_color: { label: 'Riquadro Rete Colore testo', helper: 'Colore per tutto il testo nel riquadro rete. Vuoto = colori singoli.' },
          dev_pv_box_x: { label: 'Riquadro PV X (px)', helper: 'Riquadro in alto a sinistra. PV Totale (somma) + Produzione giornaliera.' },
          dev_pv_box_y: { label: 'Riquadro PV Y (px)', helper: 'Posizione verticale.' },
          dev_pv_box_width: { label: 'Riquadro PV Larghezza (px)', helper: '' },
          dev_pv_box_height: { label: 'Riquadro PV Altezza (px)', helper: '' },
          dev_pv_box_font_size: { label: 'Riquadro PV Dimensione font (px)', helper: 'Dimensione carattere per il testo nel riquadro PV. Vuoto = scalatura automatica.' },
          dev_pv_box_text_color: { label: 'Riquadro PV Colore testo', helper: 'Colore per tutto il testo nel riquadro PV. Vuoto = colore PV totale.' },
          overlay_image_pro_1: { label: 'Immagine Overlay Pro 1', helper: 'Percorso dell\'immagine overlay pro 1 (es. /local/community/lumina-energy-card/overlay_pro_1.png).' },
          overlay_image_pro_2: { label: 'Immagine Overlay Pro 2', helper: 'Percorso dell\'immagine overlay pro 2 (es. /local/community/lumina-energy-card/overlay_pro_2.png).' },
          overlay_image_pro_3: { label: 'Immagine Overlay Pro 3', helper: 'Percorso dell\'immagine overlay pro 3 (es. /local/community/lumina-energy-card/overlay_pro_3.png).' },
          overlay_image_pro_4: { label: 'Immagine Overlay Pro 4', helper: 'Percorso dell\'immagine overlay pro 4 (es. /local/community/lumina-energy-card/overlay_pro_4.png).' },
          overlay_image_pro_5: { label: 'Immagine Overlay Pro 5', helper: 'Percorso dell\'immagine overlay pro 5 (es. /local/community/lumina-energy-card/overlay_pro_5.png).' },
        },
        options: {
          languages: [
            { value: 'en', label: 'Inglese' },
            { value: 'it', label: 'Italiano' },
            { value: 'de', label: 'Tedesco' },
            { value: 'fr', label: 'Francese' },
            { value: 'nl', label: 'Olandese' }
          ],
          display_units: [
            { value: 'W', label: 'Watt (W)' },
            { value: 'kW', label: 'Kilowatt (kW)' }
          ],
          animation_styles: [
            { value: 'dashes', label: 'Tratteggi (predefinito)' },
            { value: 'dots', label: 'Punti' },
            { value: 'arrows', label: 'Frecce' },
            { value: 'shimmer', label: 'Scintillio' }
          ]
        }
      ,
      view: {
        daily: 'PRODUZIONE OGGI',
        pv_tot: 'PV TOTALE',
        car1: 'AUTO 1',
        car2: 'AUTO 2',
        importing: 'IMPORTAZIONE',
        exporting: 'ESPORTAZIONE'
      }
      },
      de: {
        sections: {
          language: { title: 'Sprache', helper: 'Editor-Sprache waehlen.' },
          installation_type: { title: 'Installationstyp', helper: 'Wählen Sie Ihren Installationstyp, um die Karte entsprechend zu konfigurieren.' },
          general: { title: 'Allgemeine Einstellungen', helper: 'Kartentitel, Hintergrund und Aktualisierungsintervall.' },
          array1: { title: 'Array 1', helper: 'PV Array 1 Entitaeten konfigurieren.' },
          array2: { title: 'Array 2', helper: 'Wenn der PV-Gesamtsensor (WR 2) gesetzt ist oder die PV-String-Werte bereitgestellt werden, wird Array 2 aktiviert und der zweite Wechselrichter aktiviert. Sie müssen auch den Tagesproduktionssensor (Array 2) und die Hauslast (WR 2) aktivieren.' },
          battery: { title: 'Batterie', helper: 'Batterie-Entitaeten konfigurieren.' },
          grid: { title: 'Netz/Haus', helper: 'Netz- und Haus-Entitaeten konfigurieren.' },
          car: { title: 'Auto', helper: 'EV-Entitaeten konfigurieren.' },
          heatPump: { title: 'Waermepumpe', helper: 'Waermepumpen-Leistungsentitaet konfigurieren. Fluss und Text nur bei Konfiguration sichtbar.' },
          entities: { title: 'Entitaetenauswahl', helper: 'PV-, Batterie-, Netz-, Verbrauchs- und optionale EV-Entitaeten waehlen. Entweder der PV-Gesamt-Sensor oder Ihre PV-String-Arrays muessen mindestens angegeben werden.' },
          house_management: { title: 'Hausverwaltung', helper: 'Entitäten den Home-Icon-Schaltflächen zuweisen (Kamera, Licht, Temperatur, Sicherheit, Luftfeuchtigkeit). Bis zu 6 pro Icon. Klick auf Kamera-Icon öffnet Stream-Popup.' },
          pvPopup: { title: 'PV Popup', helper: 'Entitaeten fuer die PV-Popup-Anzeige konfigurieren.' },
          housePopup: { title: 'Haus-Popup', helper: 'Entitäten für die Haus-Popup-Anzeige konfigurieren. Entitäten wie Lichter, Schalter und input_boolean zeigen einen Toggle-Schalter zur Steuerung an.' },
          batteryPopup: { title: 'Batterie-Popup', helper: 'Konfigurieren Sie die Batterie-Popup-Anzeige.' },
          gridPopup: { title: 'Netz-Popup', helper: 'Entitaeten fuer die Netz-Popup-Anzeige konfigurieren.' },
          inverterPopup: { title: 'Inverter-Popup', helper: 'Entitaeten fuer die Inverter-Popup-Anzeige konfigurieren.' },
          colors: { title: 'Farben & Schwellwerte', helper: 'Grenzwerte und Farben fuer Netz- und EV-Anzeige einstellen.' },
          flow_colors: { title: 'Flussfarben', helper: 'Konfigurieren Sie Farben für Energiefluss-Animationen.' },
          animation_styles: { title: 'Animationsstile', helper: 'Fluss-Animationsstil (Striche, Punkte, Pfeile, Shimmer). Standard: Shimmer.' },
          typography: { title: 'Typografie', helper: 'Schriftgroessen der Karte feinjustieren.' },
          flow_path_custom: { title: 'Benutzerdefinierte Flusspfade', helper: 'Passen Sie die Flusspfade an, indem Sie SVG-Pfadzeichenfolgen ändern. Leer lassen, um Standardpfade zu verwenden. Sie können benutzerdefinierte Pfade mit Offsets aus dem Fluss-Pfad-Bereich kombinieren.' },
          lumina_pro: { title: 'Lumina PRO', helper: '⚠️ PRO-FUNKTIONEN: Premium-Funktionen einschließlich Overlay-Bilder, benutzerdefinierte Flüsse und benutzerdefinierte Texte. Zum Freischalten: senden Sie 1€ an PayPal (3dprint8616@gmail.com) mit Ihrer E-Mail-Adresse in der Nachricht.' },
          layout: { title: 'Layout & Textpositionen', helper: 'Schieberegler zeigen exakte X, Y (px) und Winkel (°). Step 1 für präzise Werte—notieren für definitive YAML. ViewBox 800×450. Speichern und Dashboard prüfen. YAML: dev_text_*_x, _y, _rotate, _skewX, _skewY, _scaleX, _scaleY.' },
          socBar: { title: 'SOC-Balken', helper: '6-Segment-Balken an der Batterie. Position, Deckkraft, Leuchten, Farben.' },
          gridBox: { title: 'Netz-Box', helper: 'Box oben rechts: Import/Export + Tageswerte. Position und Größe.' },
          pvBox: { title: 'PV-Box', helper: 'Box oben links: PV Gesamt (Summe Array) + Tagesproduktion. Position und Größe.' },
          batteryFill: { title: 'Batterie-Fill Position', helper: 'Schieberegler zeigen exakte Koordinaten (px) und Winkel (°). Werte für definitive YAML notieren. YAML: dev_battery_fill_x, _y_base, _width, _max_height, _rotate, _skew_x, _skew_y.' },
          overlay_image: { title: 'Overlay-Bild', helper: 'Konfigurieren Sie ein Overlay-PNG-Bild, das über dem Hintergrundbild angezeigt wird. Verwenden Sie Schieberegler, um das Overlay zu positionieren und zu ändern.' },
          custom_flows: { title: 'Benutzerdefinierte Flüsse', helper: 'Erstellen Sie zusätzliche Energieflüsse, indem Sie einen Sensor, einen SVG-Pfad, eine Farbe und einen Aktivierungsschwellenwert definieren. Nützlich zur Visualisierung benutzerdefinierter Energiequellen oder Lasten.' },
          about: { title: 'Info', helper: 'Credits, Version und nuetzliche Links.' }
        },
        fields: {
          card_title: { label: 'Kartentitel', helper: 'Titel oben auf der Karte. Leer lassen, um zu deaktivieren.' },
          overlay_image_enabled: { label: 'Overlay-Bild aktivieren', helper: 'Overlay-Bild aktivieren oder deaktivieren.' },
          overlay_image: { label: 'Overlay-Bildpfad', helper: 'Pfad zu einem Overlay-PNG-Bild, das über dem Hintergrund angezeigt wird (z. B. /local/community/lumina-energy-card/overlay.png).' },
          overlay_image_x: { label: 'Overlay-Bild X-Position (px)', helper: 'Horizontale Position des Overlay-Bildes. Standard: 0.' },
          overlay_image_y: { label: 'Overlay-Bild Y-Position (px)', helper: 'Vertikale Position des Overlay-Bildes. Standard: 0.' },
          overlay_image_width: { label: 'Overlay-Bildbreite (px)', helper: 'Breite des Overlay-Bildes. Standard: 800.' },
          overlay_image_height: { label: 'Overlay-Bildhöhe (px)', helper: 'Höhe des Overlay-Bildes. Standard: 450.' },
          overlay_image_opacity: { label: 'Overlay-Bilddeckkraft', helper: 'Deckkraft des Overlay-Bildes (0.0 bis 1.0). Standard: 1.0.' },
          overlay_image_2_enabled: { label: 'Overlay-Bild 2 aktivieren', helper: 'Zweites Overlay-Bild aktivieren oder deaktivieren.' },
          overlay_image_2: { label: 'Overlay-Bild 2 Pfad', helper: 'Pfad zu einem zweiten Overlay-PNG-Bild, das über dem Hintergrund angezeigt wird (z. B. /local/community/lumina-energy-card/overlay2.png).' },
          overlay_image_2_x: { label: 'Overlay-Bild 2 X-Position (px)', helper: 'Horizontale Position des zweiten Overlay-Bildes. Standard: 0.' },
          overlay_image_2_y: { label: 'Overlay-Bild 2 Y-Position (px)', helper: 'Vertikale Position des zweiten Overlay-Bildes. Standard: 0.' },
          overlay_image_2_width: { label: 'Overlay-Bild 2 Breite (px)', helper: 'Breite des zweiten Overlay-Bildes. Standard: 800.' },
          overlay_image_2_height: { label: 'Overlay-Bild 2 Höhe (px)', helper: 'Höhe des zweiten Overlay-Bildes. Standard: 450.' },
          overlay_image_2_opacity: { label: 'Overlay-Bild 2 Deckkraft', helper: 'Deckkraft des zweiten Overlay-Bildes (0.0 bis 1.0). Standard: 1.0.' },
          overlay_image_3_enabled: { label: 'Overlay-Bild 3 aktivieren', helper: 'Drittes Overlay-Bild aktivieren oder deaktivieren.' },
          overlay_image_3: { label: 'Overlay-Bild 3 Pfad', helper: 'Pfad zu einem dritten Overlay-PNG-Bild, das über dem Hintergrund angezeigt wird (z. B. /local/community/lumina-energy-card/overlay3.png).' },
          overlay_image_3_x: { label: 'Overlay-Bild 3 X-Position (px)', helper: 'Horizontale Position des dritten Overlay-Bildes. Standard: 0.' },
          overlay_image_3_y: { label: 'Overlay-Bild 3 Y-Position (px)', helper: 'Vertikale Position des dritten Overlay-Bildes. Standard: 0.' },
          overlay_image_3_width: { label: 'Overlay-Bild 3 Breite (px)', helper: 'Breite des dritten Overlay-Bildes. Standard: 800.' },
          overlay_image_3_height: { label: 'Overlay-Bild 3 Höhe (px)', helper: 'Höhe des dritten Overlay-Bildes. Standard: 450.' },
          overlay_image_3_opacity: { label: 'Overlay-Bild 3 Deckkraft', helper: 'Deckkraft des dritten Overlay-Bildes (0.0 bis 1.0). Standard: 1.0.' },
          overlay_image_4_enabled: { label: 'Overlay-Bild 4 aktivieren', helper: 'Viertes Overlay-Bild aktivieren oder deaktivieren.' },
          overlay_image_4: { label: 'Overlay-Bild 4 Pfad', helper: 'Pfad zu einem vierten Overlay-PNG-Bild, das über dem Hintergrund angezeigt wird (z. B. /local/community/lumina-energy-card/overlay4.png).' },
          overlay_image_4_x: { label: 'Overlay-Bild 4 X-Position (px)', helper: 'Horizontale Position des vierten Overlay-Bildes. Standard: 0.' },
          overlay_image_4_y: { label: 'Overlay-Bild 4 Y-Position (px)', helper: 'Vertikale Position des vierten Overlay-Bildes. Standard: 0.' },
          overlay_image_4_width: { label: 'Overlay-Bild 4 Breite (px)', helper: 'Breite des vierten Overlay-Bildes. Standard: 800.' },
          overlay_image_4_height: { label: 'Overlay-Bild 4 Höhe (px)', helper: 'Höhe des vierten Overlay-Bildes. Standard: 450.' },
          overlay_image_4_opacity: { label: 'Overlay-Bild 4 Deckkraft', helper: 'Deckkraft des vierten Overlay-Bildes (0.0 bis 1.0). Standard: 1.0.' },
          overlay_image_5_enabled: { label: 'Overlay-Bild 5 aktivieren', helper: 'Fünftes Overlay-Bild aktivieren oder deaktivieren.' },
          overlay_image_5: { label: 'Overlay-Bild 5 Pfad', helper: 'Pfad zu einem fünften Overlay-PNG-Bild, das über dem Hintergrund angezeigt wird (z. B. /local/community/lumina-energy-card/overlay5.png).' },
          overlay_image_5_x: { label: 'Overlay-Bild 5 X-Position (px)', helper: 'Horizontale Position des fünften Overlay-Bildes. Standard: 0.' },
          overlay_image_5_y: { label: 'Overlay-Bild 5 Y-Position (px)', helper: 'Vertikale Position des fünften Overlay-Bildes. Standard: 0.' },
          overlay_image_5_width: { label: 'Overlay-Bild 5 Breite (px)', helper: 'Breite des fünften Overlay-Bildes. Standard: 800.' },
          overlay_image_5_height: { label: 'Overlay-Bild 5 Höhe (px)', helper: 'Höhe des fünften Overlay-Bildes. Standard: 450.' },
          overlay_image_5_opacity: { label: 'Overlay-Bild 5 Deckkraft', helper: 'Deckkraft des fünften Overlay-Bildes (0.0 bis 1.0). Standard: 1.0.' },
          language: { label: 'Sprache', helper: 'Editor-Sprache waehlen.' },
          display_unit: { label: 'Anzeigeeinheit', helper: 'Einheit fuer Leistungswerte.' },
          update_interval: { label: 'Aktualisierungsintervall', helper: 'Aktualisierungsfrequenz der Karte (0 deaktiviert das Limit).' },
          animation_speed_factor: { label: 'Animationsgeschwindigkeit', helper: 'Animationsfaktor zwischen -3x und 3x. 0 pausiert, negative Werte kehren den Fluss um.' },
          animation_style: { label: 'Animationsstil', helper: 'Motiv der Flussanimation waehlen (Striche, Punkte, Pfeile oder flüssiger Fluss).' },
          fluid_flow_outer_glow: { label: 'Fluid Flow Outer Glow', helper: 'Aktiviert die zusätzliche äußere Halo/Glühen-Schicht für animation_style: fluid_flow.' },
          flow_stroke_width: { label: 'Fluss Strichbreite (px)', helper: 'Optionale Überschreibung für die animierte Fluss-Strichbreite (keine SVG-Bearbeitung). Leer lassen für SVG-Standardwerte.' },
          fluid_flow_stroke_width: { label: 'Fluid Flow Strichbreite (px)', helper: 'Basis-Strichbreite für animation_style: fluid_flow. Overlay/Mask-Breiten werden daraus abgeleitet (Standard 5).' },
          
          // Flow Path offsets
          pv1_flow_offset_x: { label: 'PV1 Fluss Offset X (px)', helper: 'Horizontaler Offset für PV1 Flusspfad. Positiv = rechts, negativ = links.' },
          pv1_flow_offset_y: { label: 'PV1 Fluss Offset Y (px)', helper: 'Vertikaler Offset für PV1 Flusspfad. Positiv = unten, negativ = oben.' },
          pv2_flow_offset_x: { label: 'PV2 Fluss Offset X (px)', helper: 'Horizontaler Offset für PV2 Flusspfad. Positiv = rechts, negativ = links.' },
          pv2_flow_offset_y: { label: 'PV2 Fluss Offset Y (px)', helper: 'Vertikaler Offset für PV2 Flusspfad. Positiv = unten, negativ = oben.' },
          bat_flow_offset_x: { label: 'Batterie Fluss Offset X (px)', helper: 'Horizontaler Offset für Batterie Flusspfad. Positiv = rechts, negativ = links.' },
          bat_flow_offset_y: { label: 'Batterie Fluss Offset Y (px)', helper: 'Vertikaler Offset für Batterie Flusspfad. Positiv = unten, negativ = oben.' },
          load_flow_offset_x: { label: 'Verbrauch Fluss Offset X (px)', helper: 'Horizontaler Offset für Verbrauch Flusspfad. Positiv = rechts, negativ = links.' },
          load_flow_offset_y: { label: 'Verbrauch Fluss Offset Y (px)', helper: 'Vertikaler Offset für Verbrauch Flusspfad. Positiv = unten, negativ = oben.' },
          grid_flow_offset_x: { label: 'Netz Fluss Offset X (px)', helper: 'Horizontaler Offset für Netz Flusspfad. Positiv = rechts, negativ = links.' },
          grid_flow_offset_y: { label: 'Netz Fluss Offset Y (px)', helper: 'Vertikaler Offset für Netz Flusspfad. Positiv = unten, negativ = oben.' },
          grid_house_flow_offset_x: { label: 'Netz-Haus Fluss Offset X (px)', helper: 'Horizontaler Offset für Netz-Haus Flusspfad. Positiv = rechts, negativ = links.' },
          grid_house_flow_offset_y: { label: 'Netz-Haus Fluss Offset Y (px)', helper: 'Vertikaler Offset für Netz-Haus Flusspfad. Positiv = unten, negativ = oben.' },
          car1_flow_offset_x: { label: 'Fahrzeug1 Fluss Offset X (px)', helper: 'Horizontaler Offset für Fahrzeug1 Flusspfad. Positiv = rechts, negativ = links.' },
          car1_flow_offset_y: { label: 'Fahrzeug1 Fluss Offset Y (px)', helper: 'Vertikaler Offset für Fahrzeug1 Flusspfad. Positiv = unten, negativ = oben.' },
          car2_flow_offset_x: { label: 'Fahrzeug2 Fluss Offset X (px)', helper: 'Horizontaler Offset für Fahrzeug2 Flusspfad. Positiv = rechts, negativ = links.' },
          car2_flow_offset_y: { label: 'Fahrzeug2 Fluss Offset Y (px)', helper: 'Vertikaler Offset für Fahrzeug2 Flusspfad. Positiv = unten, negativ = oben.' },
          heat_pump_flow_offset_x: { label: 'Wärmepumpe Fluss Offset X (px)', helper: 'Horizontaler Offset für Wärmepumpe Flusspfad. Positiv = rechts, negativ = links.' },
          heat_pump_flow_offset_y: { label: 'Wärmepumpe Fluss Offset Y (px)', helper: 'Vertikaler Offset für Wärmepumpe Flusspfad. Positiv = unten, negativ = oben.' },
          
          // Custom Flow Paths (SVG path strings)
          pv1_flow_path: { label: 'PV1 Flusspfad (SVG)', helper: `Benutzerdefinierte SVG-Pfadzeichenfolge für PV1 Flusspfad. Leer lassen, um Standard zu verwenden. Standard: ${FLOW_PATHS.pv1}` },
          pv2_flow_path: { label: 'PV2 Flusspfad (SVG)', helper: `Benutzerdefinierte SVG-Pfadzeichenfolge für PV2 Flusspfad. Leer lassen, um Standard zu verwenden. Standard: ${FLOW_PATHS.pv2}` },
          bat_flow_path: { label: 'Batterie Flusspfad (SVG)', helper: `Benutzerdefinierte SVG-Pfadzeichenfolge für Batterie Flusspfad. Leer lassen, um Standard zu verwenden. Standard: ${FLOW_PATHS.bat}` },
          load_flow_path: { label: 'Verbrauch Flusspfad (SVG)', helper: `Benutzerdefinierte SVG-Pfadzeichenfolge für Verbrauch Flusspfad. Leer lassen, um Standard zu verwenden. Standard: ${FLOW_PATHS.load}` },
          grid_flow_path: { label: 'Netz Flusspfad (SVG)', helper: `Benutzerdefinierte SVG-Pfadzeichenfolge für Netz Flusspfad. Leer lassen, um Standard zu verwenden. Standard: ${FLOW_PATHS.grid}` },
          grid_house_flow_path: { label: 'Netz-Haus Flusspfad (SVG)', helper: `Benutzerdefinierte SVG-Pfadzeichenfolge für Netz-Haus Flusspfad. Leer lassen, um Standard zu verwenden. Standard: ${FLOW_PATHS.grid_house}` },
          car1_flow_path: { label: 'Fahrzeug1 Flusspfad (SVG)', helper: `Benutzerdefinierte SVG-Pfadzeichenfolge für Fahrzeug1 Flusspfad. Leer lassen, um Standard zu verwenden. Standard: ${FLOW_PATHS.car1}` },
          car2_flow_path: { label: 'Fahrzeug2 Flusspfad (SVG)', helper: `Benutzerdefinierte SVG-Pfadzeichenfolge für Fahrzeug2 Flusspfad. Leer lassen, um Standard zu verwenden. Standard: ${FLOW_PATHS.car2}` },
          heat_pump_flow_path: { label: 'Wärmepumpe Flusspfad (SVG)', helper: `Benutzerdefinierte SVG-Pfadzeichenfolge für Wärmepumpe Flusspfad. Leer lassen, um Standard zu verwenden. Standard: ${FLOW_PATHS.heatPump}` },
          
          sensor_pv_total: { label: 'PV Gesamt Sensor', helper: 'Optionaler aggregierter Sensor fuer die kombinierte Linie.' },
          sensor_pv_total_secondary: { label: 'PV Gesamt Sensor (WR 2)', helper: 'Optionaler zweiter Wechselrichter; wird mit dem PV-Gesamtwert addiert.' },
          sensor_pv1: { label: 'PV String 1 (Array 1)', helper: 'Primaerer Solarsensor.' },
          sensor_pv2: { label: 'PV String 2 (Array 1)' },
          sensor_pv3: { label: 'PV String 3 (Array 1)' },
          sensor_pv4: { label: 'PV String 4 (Array 1)' },
          sensor_pv5: { label: 'PV String 5 (Array 1)' },
          sensor_pv6: { label: 'PV String 6 (Array 1)' },
          show_pv_strings: { label: 'PV Strings einzeln anzeigen', helper: 'Gesamte Linie plus jede PV-String-Zeile separat einblenden.' },
          sensor_daily: { label: 'Tagesproduktion Sensor (Erforderlich)', helper: 'Sensor fuer taegliche Produktionssumme. Entweder der PV-Gesamt-Sensor oder Ihre PV-String-Arrays muessen mindestens angegeben werden.' },
          sensor_daily_array2: { label: 'Tagesproduktion Sensor (Array 2)', helper: 'Sensor fuer die taegliche Produktionssumme von Array 2.' },
          sensor_bat1_soc: { label: 'Batterie 1 SOC' },
          sensor_bat1_power: { label: 'Batterie 1 Leistung' },
          sensor_bat2_soc: { label: 'Batterie 2 SOC' },
          sensor_bat2_power: { label: 'Batterie 2 Leistung' },
          sensor_bat3_soc: { label: 'Batterie 3 SOC' },
          sensor_bat3_power: { label: 'Batterie 3 Leistung' },
          sensor_bat4_soc: { label: 'Batterie 4 SOC' },
          sensor_bat4_power: { label: 'Batterie 4 Leistung' },
          battery_power_mode: { label: 'Batterie-Leistungsmodus', helper: 'Flow: ein Sensor mit Vorzeichen (+ = Laden → Batterie, - = Entladen → Wechselrichter). Laden+Entladen: getrennte Sensoren; Laden = Fluss zur Batterie, Entladen = Fluss zum Wechselrichter.' },
          sensor_battery_flow: { label: 'Batterie Flow (vorzeichenbehaftet)', helper: 'Optional. Ein Leistungssensor: positiv = Laden (Fluss zur Batterie), negativ = Entladen (Fluss zum Wechselrichter). Modus Flow. Wenn leer: Bat 1–4 Leistung.' },
          sensor_battery_charge: { label: 'Batterie Laden', helper: 'Leistungssensor beim Laden. Fluss zur Batterie. Modus Laden+Entladen.' },
          sensor_battery_discharge: { label: 'Batterie Entladen', helper: 'Leistungssensor beim Entladen. Fluss zum Wechselrichter. Modus Laden+Entladen.' },
          sensor_home_load: { label: 'Hausverbrauch (Erforderlich)', helper: 'Sensor fuer Gesamtverbrauch des Haushalts.' },
          sensor_home_load_secondary: { label: 'Hausverbrauch (WR 2)', helper: 'Optionale Hauslast-Entitaet fuer den zweiten Wechselrichter.' },
          sensor_heat_pump_consumption: { label: 'Waermepumpenverbrauch', helper: 'Sensor fuer den Energieverbrauch der Waermepumpe.' },
          sensor_house_temperature: { label: 'Haus-Temperatursensor', helper: 'Temperatursensor, der am Haus mit Hi-Tech-Odometer-Effekt angezeigt wird.' },
          house_temperature_offset_x: { label: 'Temperatur Offset X', helper: 'Horizontaler Offset für die Temperaturanzeige (in Pixeln).' },
          house_temperature_offset_y: { label: 'Temperatur Offset Y', helper: 'Vertikaler Offset für die Temperaturanzeige (in Pixeln).' },
          house_temperature_rotation: { label: 'Temperatur Rotation', helper: 'Rotationswinkel für die Temperaturanzeige (in Grad, von -360 bis 360).' },
          sensor_grid_power: { label: 'Netzleistung', helper: 'Sensor fuer positiven/negativen Netzfluss. Geben Sie entweder diesen Sensor an oder sowohl den Netzimport-Sensor als auch den Netzexport-Sensor.' },
          sensor_grid_import: { label: 'Netzimport Sensor', helper: 'Optionale Entitaet fuer positiven Netzimport.' },
          sensor_grid_export: { label: 'Netzexport Sensor', helper: 'Optionale Entitaet fuer positiven Netzexport.' },
          sensor_grid_import_daily: { label: 'Tages-Netzimport Sensor', helper: 'Optionale Entitaet, die den kumulierten Netzimport fuer den aktuellen Tag meldet.' },
          sensor_grid_export_daily: { label: 'Tages-Netzexport Sensor', helper: 'Optionale Entitaet, die den kumulierten Netzexport fuer den aktuellen Tag meldet.' },
          pv_primary_color: { label: 'PV 1 Flussfarbe', helper: 'Farbe fuer die primaere PV-Animationslinie.' },
          pv_tot_color: { label: 'PV Gesamt Farbe', helper: 'Farbe fuer die PV Gesamt Zeile.' },
          pv_secondary_color: { label: 'PV 2 Flussfarbe', helper: 'Farbe fuer die zweite PV-Linie (falls vorhanden).' },
          pv_text_color: { label: 'PV Textfarbe', helper: 'Farbe fuer PV/Solar-Beschriftungen (Array 1).' },
          pv_font_size: { label: 'PV Schriftgroesse (px)', helper: 'Schriftgroesse fuer PV-Text (Array 1).' },
          pv_secondary_text_color: { label: 'Array 2 Textfarbe', helper: 'Farbe fuer Array 2 Textbeschriftungen.' },
          pv_secondary_font_size: { label: 'Array 2 Schriftgroesse (px)', helper: 'Schriftgroesse fuer Array 2 Text.' },
          pv_string1_color: { label: 'PV String 1 Farbe', helper: 'Ueberschreibt die Farbe fuer S1. Leer lassen um die PV-Gesamtfarbe zu nutzen.' },
          pv_string2_color: { label: 'PV String 2 Farbe', helper: 'Ueberschreibt die Farbe fuer S2. Leer lassen um die PV-Gesamtfarbe zu nutzen.' },
          pv_string3_color: { label: 'PV String 3 Farbe', helper: 'Ueberschreibt die Farbe fuer S3. Leer lassen um die PV-Gesamtfarbe zu nutzen.' },
          pv_string4_color: { label: 'PV String 4 Farbe', helper: 'Ueberschreibt die Farbe fuer S4. Leer lassen um die PV-Gesamtfarbe zu nutzen.' },
          pv_string5_color: { label: 'PV String 5 Farbe', helper: 'Ueberschreibt die Farbe fuer S5. Leer lassen um die PV-Gesamtfarbe zu nutzen.' },
          pv_string6_color: { label: 'PV String 6 Farbe', helper: 'Ueberschreibt die Farbe fuer S6. Leer lassen um die PV-Gesamtfarbe zu nutzen.' },
          load_flow_color: { label: 'Lastflussfarbe', helper: 'Farbe fuer die Hausverbrauch-Animationslinie.' },
          load_text_color: { label: 'Last Textfarbe', helper: 'Farbe fuer den Hausverbrauchstext, wenn keine Schwellen aktiv sind.' },
          inv1_color: { label: 'INV 1 Farbe', helper: 'Farbe fuer INV 1 Text/Fluss.' },
          inv2_color: { label: 'INV 2 Farbe', helper: 'Farbe fuer INV 2 Text/Fluss.' },
          load_threshold_warning: { label: 'Last Warnschwelle', helper: 'Farbe wechseln, wenn der Verbrauch diese Magnitude erreicht. Verwendet die ausgewaehlte Anzeigeeinheit.' },
          load_warning_color: { label: 'Last Warnfarbe', helper: 'Farbe bei Erreichen der Warnschwelle des Hausverbrauchs.' },
          load_threshold_critical: { label: 'Last Kritische Schwelle', helper: 'Farbe wechseln, wenn der Verbrauch diese kritische Magnitude erreicht. Verwendet die ausgewaehlte Anzeigeeinheit.' },
          load_critical_color: { label: 'Last Kritische Farbe', helper: 'Farbe bei Erreichen der kritischen Hausverbrauchsschwelle.' },
          battery_soc_color: { label: 'Batterie SOC Farbe', helper: 'Farbe für den Batterie-SOC-Prozenttext.' },
          battery_charge_color: { label: 'Batterie Ladeflussfarbe', helper: 'Farbe wenn Energie in die Batterie fliesst.' },
          battery_discharge_color: { label: 'Batterie Entladeflussfarbe', helper: 'Farbe wenn Energie aus der Batterie fliesst.' },
          grid_import_color: { label: 'Netzimport Flussfarbe', helper: 'Basisfarbe (vor Schwellwerten) beim Netzimport.' },
          grid_export_color: { label: 'Netzexport Flussfarbe', helper: 'Basisfarbe (vor Schwellwerten) beim Netzexport.' },
          car_flow_color: { label: 'EV Flussfarbe', helper: 'Farbe fuer die EV-Animationslinie.' },
          battery_fill_opacity: { label: 'Batterie-Fill Deckkraft', helper: 'Transparenz der Batteriefluessigkeit (0,05–1).' },
          grid_activity_threshold: { label: 'Netz Animationsschwelle (W)', helper: 'Ignoriere Netzfluesse mit geringerer Absolutleistung, bevor animiert wird.' },
          grid_threshold_warning: { label: 'Netz Warnschwelle', helper: 'Farbe wechseln, wenn diese Magnitude erreicht wird. Verwendet die ausgewaehlte Anzeigeeinheit.' },
          grid_warning_color: { label: 'Netz Warnfarbe', helper: 'Farbe bei Erreichen der Warnschwelle.' },
          grid_threshold_critical: { label: 'Netz Kritische Schwelle', helper: 'Farbe wechseln, wenn diese Magnitude erreicht wird. Verwendet die ausgewaehlte Anzeigeeinheit.' },
          grid_critical_color: { label: 'Netz Kritische Farbe', helper: 'Farbe bei Erreichen der kritischen Schwelle.' },
          invert_grid: { label: 'Netzwerte invertieren', helper: 'Aktivieren, wenn Import/Export vertauscht ist.' },
          enable_echo_alive: { label: 'Echo Alive aktivieren', helper: 'Aktiviert ein unsichtbares iframe, um den Silk-Browser auf Echo Show offen zu halten. Die Schaltfläche wird in einer Ecke der Karte positioniert.' },
          enable_text_toggle_button: { label: 'Text-Umschaltknopf aktivieren', helper: 'Zeigt einen Knopf auf der Karte, um die Text-Sichtbarkeit ein/auszuschalten.' },
          text_toggle_button_x: { label: 'Text-Umschaltknopf X (px)', helper: 'Horizontale Position des Text-Umschaltknopfs. Abstand vom linken Rand in Pixeln. Standard: 10px (unten-links).' },
          text_toggle_button_y: { label: 'Text-Umschaltknopf Y (px)', helper: 'Vertikale Position von oben in Pixeln. Leer lassen, um unten zu positionieren. Standard: unten.' },
          text_toggle_button_scale: { label: 'Text-Umschaltknopf Skalierung', helper: 'Skalierungsfaktor für Knopfgröße (0.5 bis 2.0). 1.0 = Standardgröße.' },
          text_visibility_sensor: { label: 'Text-Sichtbarkeits-Bewegungssensor (PRO)', helper: '⚠️ PRO-FUNKTION: Bewegungs-Sensor-Entität. Bei erkannten Bewegungen erscheinen die Texte. Perfekt für Wandtablets mit Kamera.' },
          solar_forecast_enabled: { label: 'Solarprognose aktivieren', helper: '⚠️ PRO-FUNKTION: Zeigt geschätzte Solarproduktion mit Sonnenstatus (viel/mäßig/wenig Sonne).' },
          sensor_solar_forecast: { label: 'Solarprognose Sensor', helper: 'Sensor-Entität für geschätzte Solarproduktion (in W oder kW).' },
          solar_forecast_max_power: { label: 'Solarprognose Max. Leistung (W)', helper: 'Maximale erwartete Leistung in Watt. Wird zur Berechnung des Prozentsatzes für Sonnenstatus verwendet (Standard: 10000W).' },
          solar_forecast_x: { label: 'Solarprognose X-Position (px)', helper: 'Horizontale Position des Solarprognose-Textes (in Pixeln).' },
          solar_forecast_y: { label: 'Solarprognose Y-Position (px)', helper: 'Vertikale Position des Solarprognose-Textes (in Pixeln).' },
          solar_forecast_color: { label: 'Solarprognose Farbe', helper: 'Farbe für den Solarprognose-Text (Standard: #00FFFF).' },
          solar_forecast_size: { label: 'Solarprognose Schriftgröße (px)', helper: 'Schriftgröße für den Solarprognose-Text (Standard: 16px).' },
          invert_battery: { label: 'Batterie-Werte invertieren', helper: 'Aktivieren, wenn Lade-/Entlade-Polarität vertauscht ist.' },
          sensor_car_power: { label: 'Fahrzeugleistung Sensor 1' },
          sensor_car_soc: { label: 'Fahrzeug SOC Sensor 1' },
          car_soc: { label: 'Fahrzeug SOC', helper: 'Sensor für EV-Batterie SOC.' },
          car_range: { label: 'Fahrzeug Reichweite', helper: 'Sensor für EV-Reichweite.' },
          car_efficiency: { label: 'Fahrzeug Effizienz', helper: 'Sensor für EV-Effizienz.' },
          car_charger_power: { label: 'Fahrzeug Ladegerät Leistung', helper: 'Sensor für EV-Ladegerät Leistung.' },
          car1_label: { label: 'Bezeichnung Fahrzeug 1', helper: 'Text neben den Werten des ersten EV.' },
          sensor_car2_power: { label: 'Fahrzeugleistung Sensor 2' },
          sensor_car2_soc: { label: 'Fahrzeug SOC Sensor 2' },
          car2_soc: { label: 'Fahrzeug 2 SOC', helper: 'Sensor für EV 2-Batterie SOC.' },
          car2_range: { label: 'Fahrzeug 2 Reichweite', helper: 'Sensor für EV 2-Reichweite.' },
          car2_efficiency: { label: 'Fahrzeug 2 Effizienz', helper: 'Sensor für EV 2-Effizienz.' },
          car2_charger_power: { label: 'Fahrzeug 2 Ladegerät Leistung', helper: 'Sensor für EV 2-Ladegerät Leistung.' },
          car2_power: { label: 'Fahrzeug 2 Leistung', helper: 'Sensor für EV 2-Lade-/Entladeleistung.' },
          car2_label: { label: 'Bezeichnung Fahrzeug 2', helper: 'Text neben den Werten des zweiten EV.' },
          show_car_soc: { label: 'Elektrofahrzeug 1 anzeigen', helper: 'Aktivieren, um die Werte des ersten Fahrzeugs anzuzeigen.' },
          show_car2: { label: 'Elektrofahrzeug 2 anzeigen', helper: 'Aktivieren und Sensoren zuweisen, um das zweite Fahrzeug zu zeigen.' },
          car1_bidirectional: { label: 'Bidirektionale Kapazität Auto 1', helper: 'Aktivieren, wenn Auto 1 V2X-Fähigkeit hat (kann wie eine Hausbatterie laden und entladen).' },
          car2_bidirectional: { label: 'Bidirektionale Kapazität Auto 2', helper: 'Aktivieren, wenn Auto 2 V2X-Fähigkeit hat (kann wie eine Hausbatterie laden und entladen).' },
          car1_invert_flow: { label: 'Fluss umkehren Auto 1', helper: 'Kehrt die Flussrichtung für Auto 1 um. Nützlich, wenn die Sensorpolarität umgekehrt ist.' },
          car2_invert_flow: { label: 'Fluss umkehren Auto 2', helper: 'Kehrt die Flussrichtung für Auto 2 um. Nützlich, wenn die Sensorpolarität umgekehrt ist.' },
          car_pct_color: { label: 'Farbe fuer SOC', helper: 'Hex Farbe fuer EV SOC Text (z. B. #00FFFF).' },
          car2_pct_color: { label: 'Farbe SOC Auto 2', helper: 'Hex Farbe fuer SOC Text des zweiten Fahrzeugs (faellt auf Car SOC zurueck).' },
          car1_name_color: { label: 'Farbe Name Auto 1', helper: 'Farbe fuer die Bezeichnung von Fahrzeug 1.' },
          car2_name_color: { label: 'Farbe Name Auto 2', helper: 'Farbe fuer die Bezeichnung von Fahrzeug 2.' },
          car1_color: { label: 'Farbe Auto 1', helper: 'Farbe fuer die Leistungsanzeige von Fahrzeug 1.' },
          car2_color: { label: 'Farbe Auto 2', helper: 'Farbe fuer die Leistungsanzeige von Fahrzeug 2.' },
          pro_password: { label: 'PRO-Passwort', helper: '⚠️ PRO-FUNKTION: Dies ist eine Premium-Funktion.' },
          paypal_button: 'PRO-Funktionen freischalten (1€)',
          paypal_note: 'WICHTIG: Nur als SPENDE senden. Nicht „Waren & Dienstleistungen“ nutzen. Geben Sie Ihre E-MAIL in den PayPal-Notizen an, um das Passwort zu erhalten.',
          overlay_image_enabled: { label: 'Overlay-Bild aktivieren', helper: 'Aktivieren oder deaktivieren Sie das benutzerdefinierte Overlay-Bild (erfordert PRO-Autorisierung).' },
          heat_pump_flow_color: { label: 'Waermepumpenfluss Farbe', helper: 'Farbe fuer die Waermepumpenfluss Animation.' },
          heat_pump_text_color: { label: 'Waermepumpentext Farbe', helper: 'Farbe fuer den Waermepumpenleistungstext.' },
          header_font_size: { label: 'Schriftgroesse Titel (px)', helper: 'Standard 16' },
          daily_label_font_size: { label: 'Schriftgroesse Tageslabel (px)', helper: 'Standard 12' },
          daily_value_font_size: { label: 'Schriftgroesse Tageswert (px)', helper: 'Standard 20' },
          pv_font_size: { label: 'Schriftgroesse PV Text (px)', helper: 'Standard 16' },
          battery_soc_font_size: { label: 'Schriftgroesse Batterie SOC (px)', helper: 'Standard 20' },
          battery_power_font_size: { label: 'Schriftgroesse Batterie Leistung (px)', helper: 'Standard 16' },
          load_font_size: { label: 'Schriftgroesse Last (px)', helper: 'Standard 15' },
          heat_pump_font_size: { label: 'Schriftgroesse Waermepumpe (px)', helper: 'Standard 16' },
          grid_font_size: { label: 'Schriftgroesse Netz (px)', helper: 'Standard 15' },
          car_power_font_size: { label: 'Schriftgroesse Fahrzeugleistung (px)', helper: 'Standard 15' },
          car_soc_font_size: { label: 'Schriftgroesse Fahrzeug SOC (px)', helper: 'Standard 12' },
          sensor_popup_pv_1: { label: 'PV Popup 1', helper: 'Entitaet fuer PV Popup Zeile 1.' },
          sensor_popup_pv_2: { label: 'PV Popup 2', helper: 'Entitaet fuer PV Popup Zeile 2.' },
          sensor_popup_pv_3: { label: 'PV Popup 3', helper: 'Entitaet fuer PV Popup Zeile 3.' },
          sensor_popup_pv_4: { label: 'PV Popup 4', helper: 'Entitaet fuer PV Popup Zeile 4.' },
          sensor_popup_pv_5: { label: 'PV Popup 5', helper: 'Entitaet fuer PV Popup Zeile 5.' },
          sensor_popup_pv_6: { label: 'PV Popup 6', helper: 'Entitaet fuer PV Popup Zeile 6.' },
          sensor_popup_pv_1_name: { label: 'Name PV Popup 1', helper: 'Optionaler benutzerdefinierter Name fuer PV Popup Zeile 1. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_pv_2_name: { label: 'Name PV Popup 2', helper: 'Optionaler benutzerdefinierter Name fuer PV Popup Zeile 2. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_pv_3_name: { label: 'Name PV Popup 3', helper: 'Optionaler benutzerdefinierter Name fuer PV Popup Zeile 3. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_pv_4_name: { label: 'Name PV Popup 4', helper: 'Optionaler benutzerdefinierter Name fuer PV Popup Zeile 4. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_pv_5_name: { label: 'Name PV Popup 5', helper: 'Optionaler benutzerdefinierter Name fuer PV Popup Zeile 5. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_pv_6_name: { label: 'Name PV Popup 6', helper: 'Optionaler benutzerdefinierter Name fuer PV Popup Zeile 6. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_pv_1_color: { label: 'Farbe PV Popup 1', helper: 'Farbe fuer PV Popup Zeile 1 Text.' },
          sensor_popup_pv_2_color: { label: 'Farbe PV Popup 2', helper: 'Farbe fuer PV Popup Zeile 2 Text.' },
          sensor_popup_pv_3_color: { label: 'Farbe PV Popup 3', helper: 'Farbe fuer PV Popup Zeile 3 Text.' },
          sensor_popup_pv_4_color: { label: 'Farbe PV Popup 4', helper: 'Farbe fuer PV Popup Zeile 4 Text.' },
          sensor_popup_pv_5_color: { label: 'Farbe PV Popup 5', helper: 'Farbe fuer PV Popup Zeile 5 Text.' },
          sensor_popup_pv_6_color: { label: 'Farbe PV Popup 6', helper: 'Farbe fuer PV Popup Zeile 6 Text.' },
          sensor_popup_pv_1_font_size: { label: 'Schriftgroesse PV Popup 1 (px)', helper: 'Schriftgroesse fuer PV Popup Zeile 1. Standard 16' },
          sensor_popup_pv_2_font_size: { label: 'Schriftgroesse PV Popup 2 (px)', helper: 'Schriftgroesse fuer PV Popup Zeile 2. Standard 16' },
          sensor_popup_pv_3_font_size: { label: 'Schriftgroesse PV Popup 3 (px)', helper: 'Schriftgroesse fuer PV Popup Zeile 3. Standard 16' },
          sensor_popup_pv_4_font_size: { label: 'Schriftgroesse PV Popup 4 (px)', helper: 'Schriftgroesse fuer PV Popup Zeile 4. Standard 16' },
          sensor_popup_pv_5_font_size: { label: 'Schriftgroesse PV Popup 5 (px)', helper: 'Schriftgroesse fuer PV Popup Zeile 5. Standard 16' },
          sensor_popup_pv_6_font_size: { label: 'Schriftgroesse PV Popup 6 (px)', helper: 'Schriftgroesse fuer PV Popup Zeile 6. Standard 16' },
          sensor_popup_house_1: { label: 'Haus-Popup 1', helper: 'Entitaet fuer Haus-Popup Zeile 1.' },
          sensor_popup_house_1_name: { label: 'Name Haus-Popup 1', helper: 'Optionaler benutzerdefinierter Name fuer Haus-Popup Zeile 1. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_house_1_color: { label: 'Farbe Haus-Popup 1', helper: 'Farbe fuer Haus-Popup Zeile 1 Text.' },
          sensor_popup_house_1_font_size: { label: 'Schriftgroesse Haus-Popup 1 (px)', helper: 'Schriftgroesse fuer Haus-Popup Zeile 1. Standard 16' },
          sensor_popup_house_2: { label: 'Haus-Popup 2', helper: 'Entitaet fuer Haus-Popup Zeile 2.' },
          sensor_popup_house_2_name: { label: 'Name Haus-Popup 2', helper: 'Optionaler benutzerdefinierter Name fuer Haus-Popup Zeile 2. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_house_2_color: { label: 'Farbe Haus-Popup 2', helper: 'Farbe fuer Haus-Popup Zeile 2 Text.' },
          sensor_popup_house_2_font_size: { label: 'Schriftgroesse Haus-Popup 2 (px)', helper: 'Schriftgroesse fuer Haus-Popup Zeile 2. Standard 16' },
          sensor_popup_house_3: { label: 'Haus-Popup 3', helper: 'Entitaet fuer Haus-Popup Zeile 3.' },
          sensor_popup_house_3_name: { label: 'Name Haus-Popup 3', helper: 'Optionaler benutzerdefinierter Name fuer Haus-Popup Zeile 3. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_house_3_color: { label: 'Farbe Haus-Popup 3', helper: 'Farbe fuer Haus-Popup Zeile 3 Text.' },
          sensor_popup_house_3_font_size: { label: 'Schriftgroesse Haus-Popup 3 (px)', helper: 'Schriftgroesse fuer Haus-Popup Zeile 3. Standard 16' },
          sensor_popup_house_4: { label: 'Haus-Popup 4', helper: 'Entitaet fuer Haus-Popup Zeile 4.' },
          sensor_popup_house_4_name: { label: 'Name Haus-Popup 4', helper: 'Optionaler benutzerdefinierter Name fuer Haus-Popup Zeile 4. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_house_4_color: { label: 'Farbe Haus-Popup 4', helper: 'Farbe fuer Haus-Popup Zeile 4 Text.' },
          sensor_popup_house_4_font_size: { label: 'Schriftgroesse Haus-Popup 4 (px)', helper: 'Schriftgroesse fuer Haus-Popup Zeile 4. Standard 16' },
          sensor_popup_house_5: { label: 'Haus-Popup 5', helper: 'Entitaet fuer Haus-Popup Zeile 5.' },
          sensor_popup_house_5_name: { label: 'Name Haus-Popup 5', helper: 'Optionaler benutzerdefinierter Name fuer Haus-Popup Zeile 5. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_house_5_color: { label: 'Farbe Haus-Popup 5', helper: 'Farbe fuer Haus-Popup Zeile 5 Text.' },
          sensor_popup_house_5_font_size: { label: 'Schriftgroesse Haus-Popup 5 (px)', helper: 'Schriftgroesse fuer Haus-Popup Zeile 5. Standard 16' },
          sensor_popup_house_6: { label: 'Haus-Popup 6', helper: 'Entitaet fuer Haus-Popup Zeile 6.' },
          sensor_popup_house_6_name: { label: 'Name Haus-Popup 6', helper: 'Optionaler benutzerdefinierter Name fuer Haus-Popup Zeile 6. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_house_6_color: { label: 'Farbe Haus-Popup 6', helper: 'Farbe fuer Haus-Popup Zeile 6 Text.' },
          sensor_popup_house_6_font_size: { label: 'Schriftgroesse Haus-Popup 6 (px)', helper: 'Schriftgroesse fuer Haus-Popup Zeile 6. Standard 16' },
          sensor_popup_bat_1: { label: 'Battery Popup 1', helper: 'Entitaet fuer Battery Popup Zeile 1.' },
          sensor_popup_bat_1_name: { label: 'Name Battery Popup 1', helper: 'Optionaler benutzerdefinierter Name fuer Battery Popup Zeile 1. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_bat_1_color: { label: 'Farbe Battery Popup 1', helper: 'Farbe fuer Battery Popup Zeile 1 Text.' },
          sensor_popup_bat_1_font_size: { label: 'Schriftgroesse Battery Popup 1 (px)', helper: 'Schriftgroesse fuer Battery Popup Zeile 1. Standard 16' },
          sensor_popup_bat_2: { label: 'Battery Popup 2', helper: 'Entitaet fuer Battery Popup Zeile 2.' },
          sensor_popup_bat_2_name: { label: 'Name Battery Popup 2', helper: 'Optionaler benutzerdefinierter Name fuer Battery Popup Zeile 2. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_bat_2_color: { label: 'Farbe Battery Popup 2', helper: 'Farbe fuer Battery Popup Zeile 2 Text.' },
          sensor_popup_bat_2_font_size: { label: 'Schriftgroesse Battery Popup 2 (px)', helper: 'Schriftgroesse fuer Battery Popup Zeile 2. Standard 16' },
          sensor_popup_bat_3: { label: 'Battery Popup 3', helper: 'Entitaet fuer Battery Popup Zeile 3.' },
          sensor_popup_bat_3_name: { label: 'Name Battery Popup 3', helper: 'Optionaler benutzerdefinierter Name fuer Battery Popup Zeile 3. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_bat_3_color: { label: 'Farbe Battery Popup 3', helper: 'Farbe fuer Battery Popup Zeile 3 Text.' },
          sensor_popup_bat_3_font_size: { label: 'Schriftgroesse Battery Popup 3 (px)', helper: 'Schriftgroesse fuer Battery Popup Zeile 3. Standard 16' },
          sensor_popup_bat_4: { label: 'Battery Popup 4', helper: 'Entitaet fuer Battery Popup Zeile 4.' },
          sensor_popup_bat_4_name: { label: 'Name Battery Popup 4', helper: 'Optionaler benutzerdefinierter Name fuer Battery Popup Zeile 4. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_bat_4_color: { label: 'Farbe Battery Popup 4', helper: 'Farbe fuer Battery Popup Zeile 4 Text.' },
          sensor_popup_bat_4_font_size: { label: 'Schriftgroesse Battery Popup 4 (px)', helper: 'Schriftgroesse fuer Battery Popup Zeile 4. Standard 16' },
          sensor_popup_bat_5: { label: 'Battery Popup 5', helper: 'Entitaet fuer Battery Popup Zeile 5.' },
          sensor_popup_bat_5_name: { label: 'Name Battery Popup 5', helper: 'Optionaler benutzerdefinierter Name fuer Battery Popup Zeile 5. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_bat_5_color: { label: 'Farbe Battery Popup 5', helper: 'Farbe fuer Battery Popup Zeile 5 Text.' },
          sensor_popup_bat_5_font_size: { label: 'Schriftgroesse Battery Popup 5 (px)', helper: 'Schriftgroesse fuer Battery Popup Zeile 5. Standard 16' },
          sensor_popup_bat_6: { label: 'Battery Popup 6', helper: 'Entitaet fuer Battery Popup Zeile 6.' },
          sensor_popup_bat_6_name: { label: 'Name Battery Popup 6', helper: 'Optionaler benutzerdefinierter Name fuer Battery Popup Zeile 6. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_bat_6_color: { label: 'Farbe Battery Popup 6', helper: 'Farbe fuer Battery Popup Zeile 6 Text.' },
          sensor_popup_bat_6_font_size: { label: 'Schriftgroesse Battery Popup 6 (px)', helper: 'Schriftgroesse fuer Battery Popup Zeile 6. Standard 16' },
          sensor_popup_grid_1: { label: 'Grid Popup 1', helper: 'Entitaet fuer Grid Popup Zeile 1.' },
          sensor_popup_grid_1_name: { label: 'Name Grid Popup 1', helper: 'Optionaler benutzerdefinierter Name fuer Grid Popup Zeile 1. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_grid_1_color: { label: 'Farbe Grid Popup 1', helper: 'Farbe fuer Grid Popup Zeile 1 Text.' },
          sensor_popup_grid_1_font_size: { label: 'Schriftgroesse Grid Popup 1 (px)', helper: 'Schriftgroesse fuer Grid Popup Zeile 1. Standard 16' },
          sensor_popup_grid_2: { label: 'Grid Popup 2', helper: 'Entitaet fuer Grid Popup Zeile 2.' },
          sensor_popup_grid_2_name: { label: 'Name Grid Popup 2', helper: 'Optionaler benutzerdefinierter Name fuer Grid Popup Zeile 2. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_grid_2_color: { label: 'Farbe Grid Popup 2', helper: 'Farbe fuer Grid Popup Zeile 2 Text.' },
          sensor_popup_grid_2_font_size: { label: 'Schriftgroesse Grid Popup 2 (px)', helper: 'Schriftgroesse fuer Grid Popup Zeile 2. Standard 16' },
          sensor_popup_grid_3: { label: 'Grid Popup 3', helper: 'Entitaet fuer Grid Popup Zeile 3.' },
          sensor_popup_grid_3_name: { label: 'Name Grid Popup 3', helper: 'Optionaler benutzerdefinierter Name fuer Grid Popup Zeile 3. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_grid_3_color: { label: 'Farbe Grid Popup 3', helper: 'Farbe fuer Grid Popup Zeile 3 Text.' },
          sensor_popup_grid_3_font_size: { label: 'Schriftgroesse Grid Popup 3 (px)', helper: 'Schriftgroesse fuer Grid Popup Zeile 3. Standard 16' },
          sensor_popup_grid_4: { label: 'Grid Popup 4', helper: 'Entitaet fuer Grid Popup Zeile 4.' },
          sensor_popup_grid_4_name: { label: 'Name Grid Popup 4', helper: 'Optionaler benutzerdefinierter Name fuer Grid Popup Zeile 4. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_grid_4_color: { label: 'Farbe Grid Popup 4', helper: 'Farbe fuer Grid Popup Zeile 4 Text.' },
          sensor_popup_grid_4_font_size: { label: 'Schriftgroesse Grid Popup 4 (px)', helper: 'Schriftgroesse fuer Grid Popup Zeile 4. Standard 16' },
          sensor_popup_grid_5: { label: 'Grid Popup 5', helper: 'Entitaet fuer Grid Popup Zeile 5.' },
          sensor_popup_grid_5_name: { label: 'Name Grid Popup 5', helper: 'Optionaler benutzerdefinierter Name fuer Grid Popup Zeile 5. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_grid_5_color: { label: 'Farbe Grid Popup 5', helper: 'Farbe fuer Grid Popup Zeile 5 Text.' },
          sensor_popup_grid_5_font_size: { label: 'Schriftgroesse Grid Popup 5 (px)', helper: 'Schriftgroesse fuer Grid Popup Zeile 5. Standard 16' },
          sensor_popup_grid_6: { label: 'Grid Popup 6', helper: 'Entitaet fuer Grid Popup Zeile 6.' },
          sensor_popup_grid_6_name: { label: 'Name Grid Popup 6', helper: 'Optionaler benutzerdefinierter Name fuer Grid Popup Zeile 6. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_grid_6_color: { label: 'Farbe Grid Popup 6', helper: 'Farbe fuer Grid Popup Zeile 6 Text.' },
          sensor_popup_grid_6_font_size: { label: 'Schriftgroesse Grid Popup 6 (px)', helper: 'Schriftgroesse fuer Grid Popup Zeile 6. Standard 16' },
          sensor_popup_inverter_1: { label: 'Inverter Popup 1', helper: 'Entitaet fuer Inverter Popup Zeile 1.' },
          sensor_popup_inverter_1_name: { label: 'Name Inverter Popup 1', helper: 'Optionaler benutzerdefinierter Name fuer Inverter Popup Zeile 1. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_inverter_1_color: { label: 'Farbe Inverter Popup 1', helper: 'Farbe fuer Inverter Popup Zeile 1 Text.' },
          sensor_popup_inverter_1_font_size: { label: 'Schriftgroesse Inverter Popup 1 (px)', helper: 'Schriftgroesse fuer Inverter Popup Zeile 1. Standard 16' },
          sensor_popup_inverter_2: { label: 'Inverter Popup 2', helper: 'Entitaet fuer Inverter Popup Zeile 2.' },
          sensor_popup_inverter_2_name: { label: 'Name Inverter Popup 2', helper: 'Optionaler benutzerdefinierter Name fuer Inverter Popup Zeile 2. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_inverter_2_color: { label: 'Farbe Inverter Popup 2', helper: 'Farbe fuer Inverter Popup Zeile 2 Text.' },
          sensor_popup_inverter_2_font_size: { label: 'Schriftgroesse Inverter Popup 2 (px)', helper: 'Schriftgroesse fuer Inverter Popup Zeile 2. Standard 16' },
          sensor_popup_inverter_3: { label: 'Inverter Popup 3', helper: 'Entitaet fuer Inverter Popup Zeile 3.' },
          sensor_popup_inverter_3_name: { label: 'Name Inverter Popup 3', helper: 'Optionaler benutzerdefinierter Name fuer Inverter Popup Zeile 3. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_inverter_3_color: { label: 'Farbe Inverter Popup 3', helper: 'Farbe fuer Inverter Popup Zeile 3 Text.' },
          sensor_popup_inverter_3_font_size: { label: 'Schriftgroesse Inverter Popup 3 (px)', helper: 'Schriftgroesse fuer Inverter Popup Zeile 3. Standard 16' },
          sensor_popup_inverter_4: { label: 'Inverter Popup 4', helper: 'Entitaet fuer Inverter Popup Zeile 4.' },
          sensor_popup_inverter_4_name: { label: 'Name Inverter Popup 4', helper: 'Optionaler benutzerdefinierter Name fuer Inverter Popup Zeile 4. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_inverter_4_color: { label: 'Farbe Inverter Popup 4', helper: 'Farbe fuer Inverter Popup Zeile 4 Text.' },
          sensor_popup_inverter_4_font_size: { label: 'Schriftgroesse Inverter Popup 4 (px)', helper: 'Schriftgroesse fuer Inverter Popup Zeile 4. Standard 16' },
          sensor_popup_inverter_5: { label: 'Inverter Popup 5', helper: 'Entitaet fuer Inverter Popup Zeile 5.' },
          sensor_popup_inverter_5_name: { label: 'Name Inverter Popup 5', helper: 'Optionaler benutzerdefinierter Name fuer Inverter Popup Zeile 5. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_inverter_5_color: { label: 'Farbe Inverter Popup 5', helper: 'Farbe fuer Inverter Popup Zeile 5 Text.' },
          sensor_popup_inverter_5_font_size: { label: 'Schriftgroesse Inverter Popup 5 (px)', helper: 'Schriftgroesse fuer Inverter Popup Zeile 5. Standard 16' },
          sensor_popup_inverter_6: { label: 'Inverter Popup 6', helper: 'Entitaet fuer Inverter Popup Zeile 6.' },
          sensor_popup_inverter_6_name: { label: 'Name Inverter Popup 6', helper: 'Optionaler benutzerdefinierter Name fuer Inverter Popup Zeile 6. Leer lassen, um den Entitaetsnamen zu verwenden.' },
          sensor_popup_inverter_6_color: { label: 'Farbe Inverter Popup 6', helper: 'Farbe fuer Inverter Popup Zeile 6 Text.' },
          sensor_popup_inverter_6_font_size: { label: 'Schriftgroesse Inverter Popup 6 (px)', helper: 'Schriftgroesse fuer Inverter Popup Zeile 6. Standard 16' },
          dev_soc_bar_x: { label: 'SOC-Balken X (px)', helper: 'Horizontale Position. ViewBox 0–800. Path M 330,370 360,360 350,270 320,280 Z → 325.' },
          dev_soc_bar_y: { label: 'SOC-Balken Y (px)', helper: 'Vertikale Position. ViewBox 0–450.' },
          dev_soc_bar_width: { label: 'SOC-Balken Breite (px)', helper: 'Balkenbreite. Path bbox 30.' },
          dev_soc_bar_height: { label: 'SOC-Balken Höhe (px)', helper: 'Balkenhöhe. Path bbox 85.' },
          dev_soc_bar_rotate: { label: 'SOC-Balken Drehung (°)', helper: 'Drehung 0–360°. -180…180 für vollen Kreis.' },
          dev_soc_bar_skew_x: { label: 'SOC-Balken Skew X (°)', helper: 'Horizontaler Schrägwinkel in Grad.' },
          dev_soc_bar_skew_y: { label: 'SOC-Balken Skew Y (°)', helper: 'Vertikaler Schrägwinkel in Grad.' },
          soc_bar_opacity: { label: 'SOC-Balken Deckkraft', helper: 'Transparenz 0,05–1.' },
          soc_bar_glow: { label: 'SOC-Balken Leuchten (px)', helper: 'Drop-Shadow-Blur auf leuchtenden Segmenten. 0 = aus.' },
          soc_bar_color_on: { label: 'SOC-Balken Farbe (an)', helper: 'Segmentfarbe wenn durch SOC beleuchtet.' },
          soc_bar_color_off: { label: 'SOC-Balken Farbe (aus)', helper: 'Segmentfarbe wenn nicht beleuchtet.' },
          dev_grid_box_x: { label: 'Netz-Box X (px)', helper: 'Box oben rechts. Import/Export + Tageswerte.' },
          dev_grid_box_y: { label: 'Netz-Box Y (px)', helper: 'Vertikale Position.' },
          dev_grid_box_width: { label: 'Netz-Box Breite (px)', helper: '' },
          dev_grid_box_height: { label: 'Netz-Box Höhe (px)', helper: '' },
          dev_grid_box_font_size: { label: 'Netz-Box Schriftgröße (px)', helper: 'Schriftgröße für Text in der Netz-Box. Leer = Auto.' },
          dev_grid_box_text_color: { label: 'Netz-Box Textfarbe', helper: 'Farbe für allen Text in der Netz-Box. Leer = Einzelfarben.' },
          dev_pv_box_x: { label: 'PV-Box X (px)', helper: 'Box oben links. PV Gesamt (Summe) + Tagesproduktion.' },
          dev_pv_box_y: { label: 'PV-Box Y (px)', helper: 'Vertikale Position.' },
          dev_pv_box_width: { label: 'PV-Box Breite (px)', helper: '' },
          dev_pv_box_height: { label: 'PV-Box Höhe (px)', helper: '' },
          dev_pv_box_font_size: { label: 'PV-Box Schriftgröße (px)', helper: 'Schriftgröße für Text in der PV-Box. Leer = Auto.' },
          dev_pv_box_text_color: { label: 'PV-Box Textfarbe', helper: 'Farbe für allen Text in der PV-Box. Leer = PV-Gesamtfarbe.' },
          overlay_image_pro_1: { label: 'Overlay Bild Pro 1', helper: 'Pfad zum Overlay Bild Pro 1 (z.B. /local/community/lumina-energy-card/overlay_pro_1.png).' },
          overlay_image_pro_2: { label: 'Overlay Bild Pro 2', helper: 'Pfad zum Overlay Bild Pro 2 (z.B. /local/community/lumina-energy-card/overlay_pro_2.png).' },
          overlay_image_pro_3: { label: 'Overlay Bild Pro 3', helper: 'Pfad zum Overlay Bild Pro 3 (z.B. /local/community/lumina-energy-card/overlay_pro_3.png).' },
          overlay_image_pro_4: { label: 'Overlay Bild Pro 4', helper: 'Pfad zum Overlay Bild Pro 4 (z.B. /local/community/lumina-energy-card/overlay_pro_4.png).' },
          overlay_image_pro_5: { label: 'Overlay Bild Pro 5', helper: 'Pfad zum Overlay Bild Pro 5 (z.B. /local/community/lumina-energy-card/overlay_pro_5.png).' },
        },
        options: {
          languages: [
            { value: 'en', label: 'Englisch' },
            { value: 'it', label: 'Italienisch' },
            { value: 'de', label: 'Deutsch' },
            { value: 'fr', label: 'Französisch' },
            { value: 'nl', label: 'Niederländisch' }
          ],
          display_units: [
            { value: 'W', label: 'Watt (W)' },
            { value: 'kW', label: 'Kilowatt (kW)' }
          ],
          animation_styles: [
            { value: 'dashes', label: 'Striche (Standard)' },
            { value: 'dots', label: 'Punkte' },
            { value: 'arrows', label: 'Pfeile' },
            { value: 'shimmer', label: 'Schimmern' }
          ]
        }
      ,
      view: {
        daily: 'TAGESERTRAG',
        pv_tot: 'PV GESAMT',
        car1: 'FAHRZEUG 1',
        car2: 'FAHRZEUG 2',
        importing: 'IMPORTIEREN',
        exporting: 'EXPORTIEREN'
      }
      },
      fr: {
        sections: {
          language: { title: 'Langue', helper: 'Choisissez la langue de l éditeur.' },
          installation_type: { title: 'Type d\'installation', helper: 'Sélectionnez votre type d\'installation pour configurer la carte en conséquence.' },
          general: { title: 'Paramètres généraux', helper: 'Métadonnées de la carte, arrière-plan et fréquence de mise à jour.' },
          array1: { title: 'Array 1', helper: 'Configurer les entités de l Array PV 1.' },
          array2: { title: 'Array 2', helper: 'Si le capteur PV total (Inverseur 2) est défini ou si les valeurs des chaînes PV sont fournies, Array 2 deviendra actif et activera le second onduleur. Vous devez également activer le capteur de production quotidienne (Array 2) et la charge domestique (Inverseur 2).' },
          battery: { title: 'Batterie', helper: 'Configurer les entités de la batterie.' },
          grid: { title: 'Réseau/Maison', helper: 'Configurer les entités du réseau et de la maison.' },
          car: { title: 'Voiture', helper: 'Configurer les entités EV.' },
          heatPump: { title: 'Pompe à chaleur', helper: "Configurer l'entité puissance de la pompe à chaleur. Flux et texte visibles uniquement si configurée." },
          entities: { title: 'Sélection d entités', helper: 'Choisissez les entités PV, batterie, réseau, charge et EV utilisées par la carte. Soit le capteur PV total, soit vos tableaux de chaînes PV doivent être spécifiés au minimum.' },
          house_management: { title: 'Gestion maison', helper: 'Associer des entités aux boutons d\'icône Home (caméras, lumières, température, sécurité, humidité). Jusqu\'à 6 par icône. Clic sur l\'icône caméra ouvre le popup flux.' },
          pvPopup: { title: 'Popup PV', helper: 'Configurer les entités pour l\'affichage du popup PV.' },
          housePopup: { title: 'Popup Maison', helper: 'Configurer les entités pour l\'affichage du popup maison.' },
          batteryPopup: { title: 'Popup Batterie', helper: 'Configurer l\'affichage du popup batterie.' },
          gridPopup: { title: 'Popup Réseau', helper: 'Configurer les entités pour l\'affichage du popup réseau.' },
          inverterPopup: { title: 'Popup Inverter', helper: 'Configurer les entités pour l\'affichage du popup inverter.' },
          colors: { title: 'Couleurs & Seuils', helper: 'Configurez les seuils réseau et les couleurs d accent pour les flux et l affichage EV.' },
          flow_colors: { title: 'Couleurs des Flux', helper: 'Configurez les couleurs pour les animations des flux d énergie.' },
          animation_styles: { title: 'Styles d Animation', helper: 'Style d animation des flux (tirets, points, flèches, scintillement). Par défaut: scintillement.' },
          typography: { title: 'Typographie', helper: 'Ajustez les tailles de police utilisées dans la carte.' },
          flow_path_custom: { title: 'Chemins de Flux Personnalisés', helper: 'Personnalisez les chemins de flux en modifiant les chaînes de chemin SVG. Laissez vide pour utiliser les chemins par défaut. Vous pouvez combiner des chemins personnalisés avec les décalages de la section Chemin de Flux.' },
          lumina_pro: { title: 'Lumina PRO', helper: '⚠️ FONCTIONS PRO : Fonctions premium incluant images overlay, flux personnalisés et textes personnalisés. Pour débloquer : envoyez 1€ à PayPal (3dprint8616@gmail.com) avec votre adresse e-mail dans le message.' },
          layout: { title: 'Mise en Page & Positions des Textes', helper: 'Curseurs : X, Y en pixels exacts et angles (°). Step 1 pour valeurs précises—notez-les pour votre YAML définitive. Zone 800×450. Enregistrez et vérifiez le tableau de bord. YAML : dev_text_*_x, _y, _rotate, _skewX, _skewY, _scaleX, _scaleY.' },
          socBar: { title: 'Barre SOC', helper: 'Barre à 6 segments sur la batterie. Position, opacité, lueur, couleurs.' },
          gridBox: { title: 'Boîte Réseau', helper: 'Boîte en haut à droite : Import/Export + totaux journaliers. Position et dimensions.' },
          pvBox: { title: 'Boîte PV', helper: 'Boîte en haut à gauche : PV Total (somme) + Production journalière. Position et dimensions.' },
          batteryFill: { title: 'Position du remplissage batterie', helper: 'Curseurs : coordonnées (px) et angles (°) exacts. Notez les valeurs pour la YAML définitive. YAML : dev_battery_fill_x, _y_base, _width, _max_height, _rotate, _skew_x, _skew_y.' },
          overlay_image: { title: 'Image Overlay', helper: 'Configurez une image PNG overlay à afficher sur l\'image d\'arrière-plan. Utilisez les curseurs pour positionner et redimensionner l\'overlay.' },
          custom_flows: { title: 'Flux Personnalisés', helper: 'Créez des flux d\'énergie supplémentaires en définissant un capteur, un chemin SVG, une couleur et un seuil d\'activation. Utile pour visualiser des sources ou charges d\'énergie personnalisées.' },
          about: { title: 'À propos', helper: 'Crédits, version et liens utiles.' }
        },
        fields: {
          card_title: { label: 'Titre de la carte', helper: 'Titre affiché en haut de la carte. Laisser vide pour désactiver.' },
          overlay_image_enabled: { label: 'Activer image overlay', helper: 'Activer ou désactiver l\'image overlay.' },
          overlay_image: { label: 'Chemin image overlay', helper: 'Chemin vers une image PNG overlay à afficher sur l\'arrière-plan (ex. /local/community/lumina-energy-card/overlay.png).' },
          overlay_image_x: { label: 'Position X image overlay (px)', helper: 'Position horizontale de l\'image overlay. Par défaut: 0.' },
          overlay_image_y: { label: 'Position Y image overlay (px)', helper: 'Position verticale de l\'image overlay. Par défaut: 0.' },
          overlay_image_width: { label: 'Largeur image overlay (px)', helper: 'Largeur de l\'image overlay. Par défaut: 800.' },
          overlay_image_height: { label: 'Hauteur image overlay (px)', helper: 'Hauteur de l\'image overlay. Par défaut: 450.' },
          overlay_image_opacity: { label: 'Opacité image overlay', helper: 'Opacité de l\'image overlay (0.0 à 1.0). Par défaut: 1.0.' },
          overlay_image_2_enabled: { label: 'Activer image overlay 2', helper: 'Activer ou désactiver la deuxième image overlay.' },
          overlay_image_2: { label: 'Chemin image overlay 2', helper: 'Chemin vers une deuxième image PNG overlay à afficher sur l\'arrière-plan (ex. /local/community/lumina-energy-card/overlay2.png).' },
          overlay_image_2_x: { label: 'Position X image overlay 2 (px)', helper: 'Position horizontale de la deuxième image overlay. Par défaut: 0.' },
          overlay_image_2_y: { label: 'Position Y image overlay 2 (px)', helper: 'Position verticale de la deuxième image overlay. Par défaut: 0.' },
          overlay_image_2_width: { label: 'Largeur image overlay 2 (px)', helper: 'Largeur de la deuxième image overlay. Par défaut: 800.' },
          overlay_image_2_height: { label: 'Hauteur image overlay 2 (px)', helper: 'Hauteur de la deuxième image overlay. Par défaut: 450.' },
          overlay_image_2_opacity: { label: 'Opacité image overlay 2', helper: 'Opacité de la deuxième image overlay (0.0 à 1.0). Par défaut: 1.0.' },
          overlay_image_3_enabled: { label: 'Activer image overlay 3', helper: 'Activer ou désactiver la troisième image overlay.' },
          overlay_image_3: { label: 'Chemin image overlay 3', helper: 'Chemin vers une troisième image PNG overlay à afficher sur l\'arrière-plan (ex. /local/community/lumina-energy-card/overlay3.png).' },
          overlay_image_3_x: { label: 'Position X image overlay 3 (px)', helper: 'Position horizontale de la troisième image overlay. Par défaut: 0.' },
          overlay_image_3_y: { label: 'Position Y image overlay 3 (px)', helper: 'Position verticale de la troisième image overlay. Par défaut: 0.' },
          overlay_image_3_width: { label: 'Largeur image overlay 3 (px)', helper: 'Largeur de la troisième image overlay. Par défaut: 800.' },
          overlay_image_3_height: { label: 'Hauteur image overlay 3 (px)', helper: 'Hauteur de la troisième image overlay. Par défaut: 450.' },
          overlay_image_3_opacity: { label: 'Opacité image overlay 3', helper: 'Opacité de la troisième image overlay (0.0 à 1.0). Par défaut: 1.0.' },
          overlay_image_4_enabled: { label: 'Activer image overlay 4', helper: 'Activer ou désactiver la quatrième image overlay.' },
          overlay_image_4: { label: 'Chemin image overlay 4', helper: 'Chemin vers une quatrième image PNG overlay à afficher sur l\'arrière-plan (ex. /local/community/lumina-energy-card/overlay4.png).' },
          overlay_image_4_x: { label: 'Position X image overlay 4 (px)', helper: 'Position horizontale de la quatrième image overlay. Par défaut: 0.' },
          overlay_image_4_y: { label: 'Position Y image overlay 4 (px)', helper: 'Position verticale de la quatrième image overlay. Par défaut: 0.' },
          overlay_image_4_width: { label: 'Largeur image overlay 4 (px)', helper: 'Largeur de la quatrième image overlay. Par défaut: 800.' },
          overlay_image_4_height: { label: 'Hauteur image overlay 4 (px)', helper: 'Hauteur de la quatrième image overlay. Par défaut: 450.' },
          overlay_image_4_opacity: { label: 'Opacité image overlay 4', helper: 'Opacité de la quatrième image overlay (0.0 à 1.0). Par défaut: 1.0.' },
          overlay_image_5_enabled: { label: 'Activer image overlay 5', helper: 'Activer ou désactiver la cinquième image overlay.' },
          overlay_image_5: { label: 'Chemin image overlay 5', helper: 'Chemin vers une cinquième image PNG overlay à afficher sur l\'arrière-plan (ex. /local/community/lumina-energy-card/overlay5.png).' },
          overlay_image_5_x: { label: 'Position X image overlay 5 (px)', helper: 'Position horizontale de la cinquième image overlay. Par défaut: 0.' },
          overlay_image_5_y: { label: 'Position Y image overlay 5 (px)', helper: 'Position verticale de la cinquième image overlay. Par défaut: 0.' },
          overlay_image_5_width: { label: 'Largeur image overlay 5 (px)', helper: 'Largeur de la cinquième image overlay. Par défaut: 800.' },
          overlay_image_5_height: { label: 'Hauteur image overlay 5 (px)', helper: 'Hauteur de la cinquième image overlay. Par défaut: 450.' },
          overlay_image_5_opacity: { label: 'Opacité image overlay 5', helper: 'Opacité de la cinquième image overlay (0.0 à 1.0). Par défaut: 1.0.' },
          language: { label: 'Langue', helper: 'Choisissez la langue de l éditeur.' },
          display_unit: { label: 'Unité d affichage', helper: 'Unité utilisée pour formater les valeurs de puissance.' },
          update_interval: { label: 'Intervalle de mise à jour', helper: 'Fréquence de rafraîchissement des mises à jour de la carte (0 désactive le throttling).' },
          animation_speed_factor: { label: 'Facteur de vitesse d animation', helper: 'Ajuste le multiplicateur de vitesse d animation (-3x à 3x). Mettre 0 pour pause; les négatifs inversent la direction.' },
          animation_style: { label: 'Style d animation', helper: 'Choisissez le motif d animation des flux (tirets, points, flèches ou flux fluide).' },
          flow_stroke_width: { label: 'Largeur trait flux (px)', helper: 'Override optionnel pour la largeur du trait animé (pas de modification SVG). Laisser vide pour conserver les valeurs par défaut SVG.' },
          
          // Flow Path offsets
          pv1_flow_offset_x: { label: 'PV1 Décalage Flux X (px)', helper: 'Décalage horizontal pour le chemin de flux PV1. Positif = droite, négatif = gauche.' },
          pv1_flow_offset_y: { label: 'PV1 Décalage Flux Y (px)', helper: 'Décalage vertical pour le chemin de flux PV1. Positif = bas, négatif = haut.' },
          pv2_flow_offset_x: { label: 'PV2 Décalage Flux X (px)', helper: 'Décalage horizontal pour le chemin de flux PV2. Positif = droite, négatif = gauche.' },
          pv2_flow_offset_y: { label: 'PV2 Décalage Flux Y (px)', helper: 'Décalage vertical pour le chemin de flux PV2. Positif = bas, négatif = haut.' },
          bat_flow_offset_x: { label: 'Batterie Décalage Flux X (px)', helper: 'Décalage horizontal pour le chemin de flux batterie. Positif = droite, négatif = gauche.' },
          bat_flow_offset_y: { label: 'Batterie Décalage Flux Y (px)', helper: 'Décalage vertical pour le chemin de flux batterie. Positif = bas, négatif = haut.' },
          load_flow_offset_x: { label: 'Charge Décalage Flux X (px)', helper: 'Décalage horizontal pour le chemin de flux charge. Positif = droite, négatif = gauche.' },
          load_flow_offset_y: { label: 'Charge Décalage Flux Y (px)', helper: 'Décalage vertical pour le chemin de flux charge. Positif = bas, négatif = haut.' },
          grid_flow_offset_x: { label: 'Réseau Décalage Flux X (px)', helper: 'Décalage horizontal pour le chemin de flux réseau. Positif = droite, négatif = gauche.' },
          grid_flow_offset_y: { label: 'Réseau Décalage Flux Y (px)', helper: 'Décalage vertical pour le chemin de flux réseau. Positif = bas, négatif = haut.' },
          grid_house_flow_offset_x: { label: 'Réseau-Maison Décalage Flux X (px)', helper: 'Décalage horizontal pour le chemin de flux réseau-maison. Positif = droite, négatif = gauche.' },
          grid_house_flow_offset_y: { label: 'Réseau-Maison Décalage Flux Y (px)', helper: 'Décalage vertical pour le chemin de flux réseau-maison. Positif = bas, négatif = haut.' },
          car1_flow_offset_x: { label: 'Véhicule1 Décalage Flux X (px)', helper: 'Décalage horizontal pour le chemin de flux véhicule1. Positif = droite, négatif = gauche.' },
          car1_flow_offset_y: { label: 'Véhicule1 Décalage Flux Y (px)', helper: 'Décalage vertical pour le chemin de flux véhicule1. Positif = bas, négatif = haut.' },
          car2_flow_offset_x: { label: 'Véhicule2 Décalage Flux X (px)', helper: 'Décalage horizontal pour le chemin de flux véhicule2. Positif = droite, négatif = gauche.' },
          car2_flow_offset_y: { label: 'Véhicule2 Décalage Flux Y (px)', helper: 'Décalage vertical pour le chemin de flux véhicule2. Positif = bas, négatif = haut.' },
          heat_pump_flow_offset_x: { label: 'Pompe à chaleur Décalage Flux X (px)', helper: 'Décalage horizontal pour le chemin de flux pompe à chaleur. Positif = droite, négatif = gauche.' },
          heat_pump_flow_offset_y: { label: 'Pompe à chaleur Décalage Flux Y (px)', helper: 'Décalage vertical pour le chemin de flux pompe à chaleur. Positif = bas, négatif = haut.' },
          
          // Custom Flow Paths (SVG path strings)
          pv1_flow_path: { label: 'PV1 Chemin de Flux (SVG)', helper: `Chaîne de chemin SVG personnalisée pour le chemin de flux PV1. Laisser vide pour utiliser la valeur par défaut. Par défaut: ${FLOW_PATHS.pv1}` },
          pv2_flow_path: { label: 'PV2 Chemin de Flux (SVG)', helper: `Chaîne de chemin SVG personnalisée pour le chemin de flux PV2. Laisser vide pour utiliser la valeur par défaut. Par défaut: ${FLOW_PATHS.pv2}` },
          bat_flow_path: { label: 'Batterie Chemin de Flux (SVG)', helper: `Chaîne de chemin SVG personnalisée pour le chemin de flux batterie. Laisser vide pour utiliser la valeur par défaut. Par défaut: ${FLOW_PATHS.bat}` },
          load_flow_path: { label: 'Charge Chemin de Flux (SVG)', helper: `Chaîne de chemin SVG personnalisée pour le chemin de flux charge. Laisser vide pour utiliser la valeur par défaut. Par défaut: ${FLOW_PATHS.load}` },
          grid_flow_path: { label: 'Réseau Chemin de Flux (SVG)', helper: `Chaîne de chemin SVG personnalisée pour le chemin de flux réseau. Laisser vide pour utiliser la valeur par défaut. Par défaut: ${FLOW_PATHS.grid}` },
          grid_house_flow_path: { label: 'Réseau-Maison Chemin de Flux (SVG)', helper: `Chaîne de chemin SVG personnalisée pour le chemin de flux réseau-maison. Laisser vide pour utiliser la valeur par défaut. Par défaut: ${FLOW_PATHS.grid_house}` },
          car1_flow_path: { label: 'Véhicule1 Chemin de Flux (SVG)', helper: `Chaîne de chemin SVG personnalisée pour le chemin de flux véhicule1. Laisser vide pour utiliser la valeur par défaut. Par défaut: ${FLOW_PATHS.car1}` },
          car2_flow_path: { label: 'Véhicule2 Chemin de Flux (SVG)', helper: `Chaîne de chemin SVG personnalisée pour le chemin de flux véhicule2. Laisser vide pour utiliser la valeur par défaut. Par défaut: ${FLOW_PATHS.car2}` },
          heat_pump_flow_path: { label: 'Pompe à chaleur Chemin de Flux (SVG)', helper: `Chaîne de chemin SVG personnalisée pour le chemin de flux pompe à chaleur. Laisser vide pour utiliser la valeur par défaut. Par défaut: ${FLOW_PATHS.heatPump}` },
          
          sensor_pv_total: { label: 'Capteur PV total', helper: 'Capteur de production agrégé optionnel affiché comme ligne combinée.' },
          sensor_pv_total_secondary: { label: 'Capteur PV total (Inverseur 2)', helper: 'Second capteur d onduleur optionnel; ajouté au total PV s il est fourni.' },
          sensor_pv1: { label: 'Chaîne PV 1 (Array 1)', helper: 'Capteur principal de production solaire.' },
          sensor_pv2: { label: 'Chaîne PV 2 (Array 1)' },
          sensor_pv3: { label: 'Chaîne PV 3 (Array 1)' },
          sensor_pv4: { label: 'Chaîne PV 4 (Array 1)' },
          sensor_pv5: { label: 'Chaîne PV 5 (Array 1)' },
          sensor_pv6: { label: 'Chaîne PV 6 (Array 1)' },
          sensor_pv_array2_1: { label: 'Chaîne PV 1 (Array 2)', helper: 'Capteur de production solaire de l Array 2.' },
          sensor_pv_array2_2: { label: 'Chaîne PV 2 (Array 2)', helper: 'Capteur de production solaire de l Array 2.' },
          sensor_pv_array2_3: { label: 'Chaîne PV 3 (Array 2)', helper: 'Capteur de production solaire de l Array 2.' },
          sensor_pv_array2_4: { label: 'Chaîne PV 4 (Array 2)', helper: 'Capteur de production solaire de l Array 2.' },
          sensor_pv_array2_5: { label: 'Chaîne PV 5 (Array 2)', helper: 'Capteur de production solaire de l Array 2.' },
          sensor_pv_array2_6: { label: 'Chaîne PV 6 (Array 2)', helper: 'Capteur de production solaire de l Array 2.' },
          show_pv_strings: { label: 'Afficher les chaînes PV individuelles', helper: 'Activez pour afficher la ligne totale plus chaque chaîne PV sur des lignes séparées.' },
          sensor_daily: { label: 'Capteur production quotidienne (Requis)', helper: 'Capteur indiquant les totaux de production journaliers. Soit le capteur PV total, soit vos tableaux de chaînes PV doivent être spécifiés au minimum.' },
          sensor_daily_array2: { label: 'Capteur production quotidienne (Array 2)', helper: 'Capteur pour les totaux de production journaliers de l Array 2.' },
          sensor_bat1_soc: { label: 'SOC Batterie 1' },
          sensor_bat1_power: { label: 'Puissance Batterie 1' },
          sensor_bat2_soc: { label: 'SOC Batterie 2' },
          sensor_bat2_power: { label: 'Puissance Batterie 2' },
          sensor_bat3_soc: { label: 'SOC Batterie 3' },
          sensor_bat3_power: { label: 'Puissance Batterie 3' },
          sensor_bat4_soc: { label: 'SOC Batterie 4' },
          sensor_bat4_power: { label: 'Puissance Batterie 4' },
          battery_power_mode: { label: 'Mode puissance batterie', helper: 'Flow : un capteur signé (+ = charge → batterie, - = décharge → onduleur). Charge+Décharge : capteurs séparés ; charge = flux vers batterie, décharge = flux vers onduleur.' },
          sensor_battery_flow: { label: 'Batterie Flow (signé)', helper: 'Optionnel. Un capteur puissance : positif = charge (flux vers batterie), négatif = décharge (flux vers onduleur). Mode Flow. Si vide : Bat 1–4 Puissance.' },
          sensor_battery_charge: { label: 'Batterie charge', helper: 'Capteur puissance en charge. Flux vers batterie. Mode Charge+Décharge.' },
          sensor_battery_discharge: { label: 'Batterie décharge', helper: 'Capteur puissance en décharge. Flux vers onduleur. Mode Charge+Décharge.' },
          sensor_home_load: { label: 'Charge domestique/consommation (Requis)', helper: 'Capteur de consommation totale du foyer.' },
          sensor_home_load_secondary: { label: 'Charge domestique (Inverseur 2)', helper: 'Capteur de charge domestique optionnel pour le second onduleur.' },
          sensor_heat_pump_consumption: { label: 'Consommation pompe à chaleur', helper: 'Capteur de consommation énergétique de la pompe à chaleur.' },
          sensor_house_temperature: { label: 'Capteur de température maison', helper: 'Capteur de température affiché sur la maison avec effet odomètre hi-tech.' },
          house_temperature_offset_x: { label: 'Décalage X Température', helper: 'Décalage horizontal pour l affichage de la température (en pixels).' },
          house_temperature_offset_y: { label: 'Décalage Y Température', helper: 'Décalage vertical pour l affichage de la température (en pixels).' },
          house_temperature_rotation: { label: 'Rotation Température', helper: 'Angle de rotation pour l affichage de la température (en degrés, de -360 à 360).' },
          sensor_grid_power: { label: 'Puissance réseau', helper: 'Capteur de flux réseau positif/négatif. Spécifiez soit ce capteur soit les capteurs Import/Export réseau.' },
          sensor_grid_import: { label: 'Capteur import réseau', helper: 'Entité optionnelle rapportant l import réseau (valeurs positives).' },
          sensor_grid_export: { label: 'Capteur export réseau', helper: 'Entité optionnelle rapportant l export réseau (valeurs positives).' },
          sensor_grid_import_daily: { label: 'Capteur import réseau journalier', helper: 'Entité optionnelle rapportant l import cumulatif réseau pour la journée en cours.' },
          sensor_grid_export_daily: { label: 'Capteur export réseau journalier', helper: 'Entité optionnelle rapportant l export cumulatif réseau pour la journée en cours.' },
          pv_tot_color: { label: 'Couleur PV totale', helper: 'Couleur appliquée à la ligne/texte PV TOTAL.' },
          pv_primary_color: { label: 'Couleur flux PV 1', helper: 'Couleur utilisée pour la ligne d animation PV primaire.' },
          pv_secondary_color: { label: 'Couleur flux PV 2', helper: 'Couleur utilisée pour la ligne d animation PV secondaire si disponible.' },
          pv_text_color: { label: 'Couleur texte PV', helper: 'Couleur pour les étiquettes PV/Solar (Array 1).' },
          pv_font_size: { label: 'Taille police PV (px)', helper: 'Taille police pour le texte PV (Array 1).' },
          pv_secondary_text_color: { label: 'Couleur texte Array 2', helper: 'Couleur pour les étiquettes Array 2.' },
          pv_secondary_font_size: { label: 'Taille police Array 2 (px)', helper: 'Taille police pour le texte Array 2.' },
          pv_string1_color: { label: 'Couleur Chaîne PV 1', helper: 'Remplace la couleur pour S1 dans la liste PV. Laisser vide pour hériter de la couleur PV totale.' },
          pv_string2_color: { label: 'Couleur Chaîne PV 2', helper: 'Remplace la couleur pour S2 dans la liste PV. Laisser vide pour hériter de la couleur PV totale.' },
          pv_string3_color: { label: 'Couleur Chaîne PV 3', helper: 'Remplace la couleur pour S3 dans la liste PV. Laisser vide pour hériter de la couleur PV totale.' },
          pv_string4_color: { label: 'Couleur Chaîne PV 4', helper: 'Remplace la couleur pour S4 dans la liste PV. Laisser vide pour hériter de la couleur PV totale.' },
          pv_string5_color: { label: 'Couleur Chaîne PV 5', helper: 'Remplace la couleur pour S5 dans la liste PV. Laisser vide pour hériter de la couleur PV totale.' },
          pv_string6_color: { label: 'Couleur Chaîne PV 6', helper: 'Remplace la couleur pour S6 dans la liste PV. Laisser vide pour hériter de la couleur PV totale.' },
          load_flow_color: { label: 'Couleur flux charge', helper: 'Couleur appliquée à la ligne d animation de la charge domestique.' },
          load_text_color: { label: 'Couleur texte charge', helper: 'Couleur appliquée au texte de charge lorsque aucun seuil n est actif.' },
          inv1_color: { label: 'Couleur INV 1', helper: 'Couleur appliquée au texte/flux INV 1.' },
          inv2_color: { label: 'Couleur INV 2', helper: 'Couleur appliquée au texte/flux INV 2.' },
          load_threshold_warning: { label: 'Seuil avertissement charge', helper: 'Changer la couleur du chargeur lorsque la magnitude atteint ou dépasse cette valeur. Utilise l unité d affichage sélectionnée.' },
          load_warning_color: { label: 'Couleur avertissement charge', helper: 'Couleur hex ou CSS appliquée au seuil d avertissement de charge.' },
          load_threshold_critical: { label: 'Seuil critique charge', helper: 'Changer la couleur lorsque la magnitude atteint ou dépasse cette valeur. Utilise l unité d affichage sélectionnée.' },
          load_critical_color: { label: 'Couleur critique charge', helper: 'Couleur hex ou CSS appliquée au seuil critique de charge.' },
          battery_soc_color: { label: 'Couleur SOC batterie', helper: 'Couleur appliquée au texte du pourcentage SOC batterie.' },
          battery_charge_color: { label: 'Couleur flux charge batterie', helper: 'Couleur utilisée lorsque l énergie entre dans la batterie.' },
          battery_discharge_color: { label: 'Couleur flux décharge batterie', helper: 'Couleur utilisée lorsque l énergie sort de la batterie.' },
          battery_fill_opacity: { label: 'Opacité remplissage batterie', helper: 'Transparence du liquide batterie (0,05–1).' },
          grid_activity_threshold: { label: 'Seuil animation réseau (W)', helper: 'Ignorer les flux réseau dont la valeur absolue est inférieure à cette puissance avant d animer.' },
          grid_threshold_warning: { label: 'Seuil avertissement réseau', helper: 'Changer la couleur réseau lorsque la magnitude atteint cette valeur. Utilise l unité d affichage sélectionnée.' },
          grid_warning_color: { label: 'Couleur avertissement réseau', helper: 'Couleur hex appliquée au seuil d avertissement.' },
          grid_threshold_critical: { label: 'Seuil critique réseau', helper: 'Changer la couleur réseau lorsque la magnitude atteint cette valeur. Utilise l unité d affichage sélectionnée.' },
          grid_critical_color: { label: 'Couleur critique réseau', helper: 'Couleur appliquée au seuil critique.' },
          invert_grid: { label: 'Inverser valeurs réseau', helper: 'Activer si la polarité import/export est inversée.' },
          enable_echo_alive: { label: 'Activer Echo Alive', helper: 'Active un iframe invisible pour garder le navigateur Silk ouvert sur Echo Show. Le bouton sera positionné dans un coin de la carte.' },
          enable_text_toggle_button: { label: 'Activer Bouton Toggle Texte', helper: 'Affiche un bouton sur la carte pour activer/désactiver la visibilité des textes.' },
          text_toggle_button_x: { label: 'Bouton Toggle Texte X (px)', helper: 'Position horizontale du bouton toggle texte. Distance du bord gauche en pixels. Par défaut: 10px (bas-gauche).' },
          text_toggle_button_y: { label: 'Bouton Toggle Texte Y (px)', helper: 'Position verticale depuis le haut en pixels. Laissez vide pour positionner en bas. Par défaut: bas.' },
          text_toggle_button_scale: { label: 'Échelle Bouton Toggle Texte', helper: 'Facteur d\'échelle pour la taille du bouton (0.5 à 2.0). 1.0 = taille par défaut.' },
          text_visibility_sensor: { label: 'Capteur de Mouvement Visibilité Texte (PRO)', helper: '⚠️ FONCTION PRO: Entité capteur de mouvement. Lorsqu\'un mouvement est détecté, les textes apparaissent. Parfait pour tablettes murales avec caméra.' },
          solar_forecast_enabled: { label: 'Activer Prévision Solaire', helper: '⚠️ FONCTION PRO: Affiche la production solaire estimée avec l\'état du soleil (beaucoup/modéré/peu de soleil).' },
          sensor_solar_forecast: { label: 'Capteur Prévision Solaire', helper: 'Entité capteur pour la production solaire estimée (en W ou kW).' },
          solar_forecast_max_power: { label: 'Prévision Solaire Puissance Max (W)', helper: 'Puissance maximale attendue en watts. Utilisée pour calculer le pourcentage pour l\'état du soleil (par défaut: 10000W).' },
          solar_forecast_x: { label: 'Prévision Solaire Position X (px)', helper: 'Position horizontale du texte prévision solaire (en pixels).' },
          solar_forecast_y: { label: 'Prévision Solaire Position Y (px)', helper: 'Position verticale du texte prévision solaire (en pixels).' },
          solar_forecast_color: { label: 'Couleur Prévision Solaire', helper: 'Couleur pour le texte prévision solaire (par défaut: #00FFFF).' },
          solar_forecast_size: { label: 'Taille Police Prévision Solaire (px)', helper: 'Taille de police pour le texte prévision solaire (par défaut: 16px).' },
          invert_battery: { label: 'Inverser valeurs batterie', helper: 'Activer si la polarité charge/décharge est inversée.' },
          sensor_car_power: { label: 'Capteur puissance Véhicule 1' },
          sensor_car_soc: { label: 'Capteur SOC Véhicule 1' },
          car_soc: { label: 'SOC Véhicule', helper: 'Capteur pour SOC batterie EV.' },
          car_range: { label: 'Autonomie Véhicule', helper: 'Capteur pour autonomie EV.' },
          car_efficiency: { label: 'Efficacité Véhicule', helper: 'Capteur pour efficacité EV.' },
          car_charger_power: { label: 'Puissance Chargeur Véhicule', helper: 'Capteur pour puissance chargeur EV.' },
          car1_label: { label: 'Libellé Véhicule 1', helper: 'Texte affiché à côté des valeurs du premier EV.' },
          sensor_car2_power: { label: 'Capteur puissance Véhicule 2' },
          sensor_car2_soc: { label: 'Capteur SOC Véhicule 2' },
          car2_soc: { label: 'SOC Véhicule 2', helper: 'Capteur pour SOC batterie EV 2.' },
          car2_range: { label: 'Autonomie Véhicule 2', helper: 'Capteur pour autonomie EV 2.' },
          car2_efficiency: { label: 'Efficacité Véhicule 2', helper: 'Capteur pour efficacité EV 2.' },
          car2_charger_power: { label: 'Puissance Chargeur Véhicule 2', helper: 'Capteur pour puissance chargeur EV 2.' },
          car2_power: { label: 'Puissance Véhicule 2', helper: 'Capteur pour puissance charge/décharge EV 2.' },
          car2_label: { label: 'Libellé Véhicule 2', helper: 'Texte affiché à côté des valeurs du second EV.' },
          show_car_soc: { label: 'Afficher Véhicule 1', helper: 'Activer pour afficher les métriques du premier véhicule.' },
          show_car2: { label: 'Afficher Véhicule 2', helper: 'Activer pour afficher les métriques du second véhicule lorsque les capteurs sont fournis.' },
          car1_bidirectional: { label: 'Capacité bidirectionnelle Véhicule 1', helper: 'Activer si le Véhicule 1 a la capacité V2X (peut charger et décharger comme une batterie domestique).' },
          car2_bidirectional: { label: 'Capacité bidirectionnelle Véhicule 2', helper: 'Activer si le Véhicule 2 a la capacité V2X (peut charger et décharger comme une batterie domestique).' },
          car1_invert_flow: { label: 'Inverser Flux Véhicule 1', helper: 'Inverse la direction du flux pour le Véhicule 1. Utile si la polarité du capteur est inversée.' },
          car2_invert_flow: { label: 'Inverser Flux Véhicule 2', helper: 'Inverse la direction du flux pour le Véhicule 2. Utile si la polarité du capteur est inversée.' },
          array1_invert_flow: { label: 'Inverser Flux Array 1', helper: 'Inverse la direction du flux pour l\'Array 1 (PV1). Utile si la polarité du capteur est inversée.' },
          array2_invert_flow: { label: 'Inverser Flux Array 2', helper: 'Inverse la direction du flux pour l\'Array 2 (PV2). Utile si la polarité du capteur est inversée.' },
          car_pct_color: { label: 'Couleur SOC Véhicule', helper: 'Couleur hex pour le texte SOC EV (ex. #00FFFF).' },
          car2_pct_color: { label: 'Couleur SOC Véhicule 2', helper: 'Couleur hex pour le SOC du second EV (retourne sur Car SOC si vide).' },
          car1_name_color: { label: 'Couleur nom Véhicule 1', helper: 'Couleur appliquée au libellé du nom du Véhicule 1.' },
          car2_name_color: { label: 'Couleur nom Véhicule 2', helper: 'Couleur appliquée au libellé du nom du Véhicule 2.' },
          car1_color: { label: 'Couleur Véhicule 1', helper: 'Couleur appliquée à la valeur de puissance du Véhicule 1.' },
          car2_color: { label: 'Couleur Véhicule 2', helper: 'Couleur appliquée à la valeur de puissance du Véhicule 2.' },
          pro_password: { label: 'Mot de passe PRO', helper: '⚠️ FONCTION PRO : C est une fonction premium.' },
          paypal_button: 'Débloquer les fonctions PRO (1€)',
          paypal_note: 'IMPORTANT : Envoyez uniquement en DON. Ne pas utiliser « Biens et services ». Incluez votre E-MAIL dans les notes PayPal pour recevoir le mot de passe.',
          overlay_image_enabled: { label: 'Activer l image de superposition', helper: 'Activer ou désactiver l image de superposition personnalisée (nécessite une autorisation PRO).' },
          heat_pump_flow_color: { label: 'Couleur flux pompe à chaleur', helper: 'Couleur appliquée à l animation du flux de la pompe à chaleur.' },
          heat_pump_text_color: { label: 'Couleur texte pompe à chaleur', helper: 'Couleur appliquée au texte de puissance de la pompe à chaleur.' },
          header_font_size: { label: 'Taille police en-tête (px)', helper: 'Par défaut 16' },
          daily_label_font_size: { label: 'Taille étiquette quotidienne (px)', helper: 'Par défaut 12' },
          daily_value_font_size: { label: 'Taille valeur quotidienne (px)', helper: 'Par défaut 20' },
          pv_font_size: { label: 'Taille police PV (px)', helper: 'Par défaut 16' },
          battery_soc_font_size: { label: 'Taille SOC batterie (px)', helper: 'Par défaut 20' },
          battery_power_font_size: { label: 'Taille puissance batterie (px)', helper: 'Par défaut 16' },
          load_font_size: { label: 'Taille police charge (px)', helper: 'Par défaut 15' },
          heat_pump_font_size: { label: 'Taille police pompe à chaleur (px)', helper: 'Par défaut 16' },
          grid_font_size: { label: 'Taille police réseau (px)', helper: 'Par défaut 15' },
          car_power_font_size: { label: 'Taille puissance véhicule (px)', helper: 'Par défaut 15' },
          car2_power_font_size: { label: 'Taille puissance Véhicule 2 (px)', helper: 'Par défaut 15' },
          car_name_font_size: { label: 'Taille nom Véhicule (px)', helper: 'Par défaut 15' },
          car2_name_font_size: { label: 'Taille nom Véhicule 2 (px)', helper: 'Par défaut 15' },
          car_soc_font_size: { label: 'Taille SOC véhicule (px)', helper: 'Par défaut 12' },
          car2_soc_font_size: { label: 'Taille SOC Véhicule 2 (px)', helper: 'Par défaut 12' },
          sensor_popup_pv_1: { label: 'Popup PV 1', helper: 'Entité pour la ligne 1 du popup PV.' },
          sensor_popup_pv_2: { label: 'Popup PV 2', helper: 'Entité pour la ligne 2 du popup PV.' },
          sensor_popup_pv_3: { label: 'Popup PV 3', helper: 'Entité pour la ligne 3 du popup PV.' },
          sensor_popup_pv_4: { label: 'Popup PV 4', helper: 'Entité pour la ligne 4 du popup PV.' },
          sensor_popup_pv_5: { label: 'Popup PV 5', helper: 'Entité pour la ligne 5 du popup PV.' },
          sensor_popup_pv_6: { label: 'Popup PV 6', helper: 'Entité pour la ligne 6 du popup PV.' },
          sensor_popup_pv_1_name: { label: 'Nom Popup PV 1', helper: 'Nom personnalisé optionnel pour la ligne 1 du popup PV. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_pv_2_name: { label: 'Nom Popup PV 2', helper: 'Nom personnalisé optionnel pour la ligne 2 du popup PV. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_pv_3_name: { label: 'Nom Popup PV 3', helper: 'Nom personnalisé optionnel pour la ligne 3 du popup PV. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_pv_4_name: { label: 'Nom Popup PV 4', helper: 'Nom personnalisé optionnel pour la ligne 4 du popup PV. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_pv_5_name: { label: 'Nom Popup PV 5', helper: 'Nom personnalisé optionnel pour la ligne 5 du popup PV. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_pv_6_name: { label: 'Nom Popup PV 6', helper: 'Nom personnalisé optionnel pour la ligne 6 du popup PV. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_pv_1_color: { label: 'Couleur Popup PV 1', helper: 'Couleur pour le texte de la ligne 1 du popup PV.' },
          sensor_popup_pv_2_color: { label: 'Couleur Popup PV 2', helper: 'Couleur pour le texte de la ligne 2 du popup PV.' },
          sensor_popup_pv_3_color: { label: 'Couleur Popup PV 3', helper: 'Couleur pour le texte de la ligne 3 du popup PV.' },
          sensor_popup_pv_4_color: { label: 'Couleur Popup PV 4', helper: 'Couleur pour le texte de la ligne 4 du popup PV.' },
          sensor_popup_pv_5_color: { label: 'Couleur Popup PV 5', helper: 'Couleur pour le texte de la ligne 5 du popup PV.' },
          sensor_popup_pv_6_color: { label: 'Couleur Popup PV 6', helper: 'Couleur pour le texte de la ligne 6 du popup PV.' },
          sensor_popup_pv_1_font_size: { label: 'Taille police Popup PV 1 (px)', helper: 'Taille de police pour la ligne 1 du popup PV. Par défaut 16' },
          sensor_popup_pv_2_font_size: { label: 'Taille police Popup PV 2 (px)', helper: 'Taille de police pour la ligne 2 du popup PV. Par défaut 16' },
          sensor_popup_pv_3_font_size: { label: 'Taille police Popup PV 3 (px)', helper: 'Taille de police pour la ligne 3 du popup PV. Par défaut 16' },
          sensor_popup_pv_4_font_size: { label: 'Taille police Popup PV 4 (px)', helper: 'Taille de police pour la ligne 4 du popup PV. Par défaut 16' },
                    sensor_popup_pv_5_font_size: { label: 'Taille police Popup PV 5 (px)', helper: 'Taille de police pour la ligne 5 du popup PV. Par défaut 16' },
          sensor_popup_pv_6_font_size: { label: 'Taille police Popup PV 6 (px)', helper: 'Taille de police pour la ligne 6 du popup PV. Par défaut 16' },
          sensor_popup_house_1: { label: 'Popup Maison 1', helper: 'Entité pour la ligne 1 du popup maison.' },
          sensor_popup_house_1_name: { label: 'Nom Popup Maison 1', helper: 'Nom personnalisé optionnel pour la ligne 1 du popup maison. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_house_1_color: { label: 'Couleur Popup Maison 1', helper: 'Couleur pour le texte de la ligne 1 du popup maison.' },
          sensor_popup_house_1_font_size: { label: 'Taille police Popup Maison 1 (px)', helper: 'Taille de police pour la ligne 1 du popup maison. Par défaut 16' },
          sensor_popup_house_2: { label: 'Popup Maison 2', helper: 'Entité pour la ligne 2 du popup maison.' },
          sensor_popup_house_2_name: { label: 'Nom Popup Maison 2', helper: 'Nom personnalisé optionnel pour la ligne 2 du popup maison. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_house_2_color: { label: 'Couleur Popup Maison 2', helper: 'Couleur pour le texte de la ligne 2 du popup maison.' },
          sensor_popup_house_2_font_size: { label: 'Taille police Popup Maison 2 (px)', helper: 'Taille de police pour la ligne 2 du popup maison. Par défaut 16' },
          sensor_popup_house_3: { label: 'Popup Maison 3', helper: 'Entité pour la ligne 3 du popup maison.' },
          sensor_popup_house_3_name: { label: 'Nom Popup Maison 3', helper: 'Nom personnalisé optionnel pour la ligne 3 du popup maison. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_house_3_color: { label: 'Couleur Popup Maison 3', helper: 'Couleur pour le texte de la ligne 3 du popup maison.' },
          sensor_popup_house_3_font_size: { label: 'Taille police Popup Maison 3 (px)', helper: 'Taille de police pour la ligne 3 du popup maison. Par défaut 16' },
          sensor_popup_house_4: { label: 'Popup Maison 4', helper: 'Entité pour la ligne 4 du popup maison.' },
          sensor_popup_house_4_name: { label: 'Nom Popup Maison 4', helper: 'Nom personnalisé optionnel pour la ligne 4 du popup maison. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_house_4_color: { label: 'Couleur Popup Maison 4', helper: 'Couleur pour le texte de la ligne 4 du popup maison.' },
          sensor_popup_house_4_font_size: { label: 'Taille police Popup Maison 4 (px)', helper: 'Taille de police pour la ligne 4 du popup maison. Par défaut 16' },
          sensor_popup_house_5: { label: 'Popup Maison 5', helper: 'Entité pour la ligne 5 du popup maison.' },
          sensor_popup_house_5_name: { label: 'Nom Popup Maison 5', helper: 'Nom personnalisé optionnel pour la ligne 5 du popup maison. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_house_5_color: { label: 'Couleur Popup Maison 5', helper: 'Couleur pour le texte de la ligne 5 du popup maison.' },
          sensor_popup_house_5_font_size: { label: 'Taille police Popup Maison 5 (px)', helper: 'Taille de police pour la ligne 5 du popup maison. Par défaut 16' },
          sensor_popup_house_6: { label: 'Popup Maison 6', helper: 'Entité pour la ligne 6 du popup maison.' },
          sensor_popup_house_6_name: { label: 'Nom Popup Maison 6', helper: 'Nom personnalisé optionnel pour la ligne 6 du popup maison. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_house_6_color: { label: 'Couleur Popup Maison 6', helper: 'Couleur pour le texte de la ligne 6 du popup maison.' },
          sensor_popup_house_6_font_size: { label: 'Taille police Popup Maison 6 (px)', helper: 'Taille de police pour la ligne 6 du popup maison. Par défaut 16' },
          sensor_popup_bat_1: { label: 'Popup Batterie 1', helper: 'Entité pour la ligne 1 du popup batterie.' },
          sensor_popup_bat_1_name: { label: 'Nom Popup Batterie 1', helper: 'Nom personnalisé optionnel pour la ligne 1 du popup batterie. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_bat_1_color: { label: 'Couleur Popup Batterie 1', helper: 'Couleur pour le texte de la ligne 1 du popup batterie.' },
          sensor_popup_bat_1_font_size: { label: 'Taille police Popup Batterie 1 (px)', helper: 'Taille de police pour la ligne 1 du popup batterie. Par défaut 16' },
          sensor_popup_bat_2: { label: 'Popup Batterie 2', helper: 'Entité pour la ligne 2 du popup batterie.' },
          sensor_popup_bat_2_name: { label: 'Nom Popup Batterie 2', helper: 'Nom personnalisé optionnel pour la ligne 2 du popup batterie. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_bat_2_color: { label: 'Couleur Popup Batterie 2', helper: 'Couleur pour le texte de la ligne 2 du popup batterie.' },
          sensor_popup_bat_2_font_size: { label: 'Taille police Popup Batterie 2 (px)', helper: 'Taille de police pour la ligne 2 du popup batterie. Par défaut 16' },
          sensor_popup_bat_3: { label: 'Popup Batterie 3', helper: 'Entité pour la ligne 3 du popup batterie.' },
          sensor_popup_bat_3_name: { label: 'Nom Popup Batterie 3', helper: 'Nom personnalisé optionnel pour la ligne 3 du popup batterie. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_bat_3_color: { label: 'Couleur Popup Batterie 3', helper: 'Couleur pour le texte de la ligne 3 du popup batterie.' },
          sensor_popup_bat_3_font_size: { label: 'Taille police Popup Batterie 3 (px)', helper: 'Taille de police pour la ligne 3 du popup batterie. Par défaut 16' },
          sensor_popup_bat_4: { label: 'Popup Batterie 4', helper: 'Entité pour la ligne 4 du popup batterie.' },
          sensor_popup_bat_4_name: { label: 'Nom Popup Batterie 4', helper: 'Nom personnalisé optionnel pour la ligne 4 du popup batterie. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_bat_4_color: { label: 'Couleur Popup Batterie 4', helper: 'Couleur pour le texte de la ligne 4 du popup batterie.' },
          sensor_popup_bat_4_font_size: { label: 'Taille police Popup Batterie 4 (px)', helper: 'Taille de police pour la ligne 4 du popup batterie. Par défaut 16' },
          sensor_popup_bat_5: { label: 'Popup Batterie 5', helper: 'Entité pour la ligne 5 du popup batterie.' },
          sensor_popup_bat_5_name: { label: 'Nom Popup Batterie 5', helper: 'Nom personnalisé optionnel pour la ligne 5 du popup batterie. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_bat_5_color: { label: 'Couleur Popup Batterie 5', helper: 'Couleur pour le texte de la ligne 5 du popup batterie.' },
          sensor_popup_bat_5_font_size: { label: 'Taille police Popup Batterie 5 (px)', helper: 'Taille de police pour la ligne 5 du popup batterie. Par défaut 16' },
          sensor_popup_bat_6: { label: 'Popup Batterie 6', helper: 'Entité pour la ligne 6 du popup batterie.' },
          sensor_popup_bat_6_name: { label: 'Nom Popup Batterie 6', helper: 'Nom personnalisé optionnel pour la ligne 6 du popup batterie. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_bat_6_color: { label: 'Couleur Popup Batterie 6', helper: 'Couleur pour le texte de la ligne 6 du popup batterie.' },
          sensor_popup_bat_6_font_size: { label: 'Taille police Popup Batterie 6 (px)', helper: 'Taille de police pour la ligne 6 du popup batterie. Par défaut 16' },
          sensor_popup_grid_1: { label: 'Popup Réseau 1', helper: 'Entité pour la ligne 1 du popup réseau.' },
          sensor_popup_grid_1_name: { label: 'Nom Popup Réseau 1', helper: 'Nom personnalisé optionnel pour la ligne 1 du popup réseau. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_grid_1_color: { label: 'Couleur Popup Réseau 1', helper: 'Couleur pour le texte de la ligne 1 du popup réseau.' },
          sensor_popup_grid_1_font_size: { label: 'Taille police Popup Réseau 1 (px)', helper: 'Taille de police pour la ligne 1 du popup réseau. Par défaut 16' },
          sensor_popup_grid_2: { label: 'Popup Réseau 2', helper: 'Entité pour la ligne 2 du popup réseau.' },
          sensor_popup_grid_2_name: { label: 'Nom Popup Réseau 2', helper: 'Nom personnalisé optionnel pour la ligne 2 du popup réseau. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_grid_2_color: { label: 'Couleur Popup Réseau 2', helper: 'Couleur pour le texte de la ligne 2 du popup réseau.' },
          sensor_popup_grid_2_font_size: { label: 'Taille police Popup Réseau 2 (px)', helper: 'Taille de police pour la ligne 2 du popup réseau. Par défaut 16' },
          sensor_popup_grid_3: { label: 'Popup Réseau 3', helper: 'Entité pour la ligne 3 du popup réseau.' },
          sensor_popup_grid_3_name: { label: 'Nom Popup Réseau 3', helper: 'Nom personnalisé optionnel pour la ligne 3 du popup réseau. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_grid_3_color: { label: 'Couleur Popup Réseau 3', helper: 'Couleur pour le texte de la ligne 3 du popup réseau.' },
          sensor_popup_grid_3_font_size: { label: 'Taille police Popup Réseau 3 (px)', helper: 'Taille de police pour la ligne 3 du popup réseau. Par défaut 16' },
          sensor_popup_grid_4: { label: 'Popup Réseau 4', helper: 'Entité pour la ligne 4 du popup réseau.' },
          sensor_popup_grid_4_name: { label: 'Nom Popup Réseau 4', helper: 'Nom personnalisé optionnel pour la ligne 4 du popup réseau. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_grid_4_color: { label: 'Couleur Popup Réseau 4', helper: 'Couleur pour le texte de la ligne 4 du popup réseau.' },
          sensor_popup_grid_4_font_size: { label: 'Taille police Popup Réseau 4 (px)', helper: 'Taille de police pour la ligne 4 du popup réseau. Par défaut 16' },
          sensor_popup_grid_5: { label: 'Popup Réseau 5', helper: 'Entité pour la ligne 5 du popup réseau.' },
          sensor_popup_grid_5_name: { label: 'Nom Popup Réseau 5', helper: 'Nom personnalisé optionnel pour la ligne 5 du popup réseau. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_grid_5_color: { label: 'Couleur Popup Réseau 5', helper: 'Couleur pour le texte de la ligne 5 du popup réseau.' },
          sensor_popup_grid_5_font_size: { label: 'Taille police Popup Réseau 5 (px)', helper: 'Taille de police pour la ligne 5 du popup réseau. Par défaut 16' },
          sensor_popup_grid_6: { label: 'Popup Réseau 6', helper: 'Entité pour la ligne 6 du popup réseau.' },
          sensor_popup_grid_6_name: { label: 'Nom Popup Réseau 6', helper: 'Nom personnalisé optionnel pour la ligne 6 du popup réseau. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_grid_6_color: { label: 'Couleur Popup Réseau 6', helper: 'Couleur pour le texte de la ligne 6 du popup réseau.' },
          sensor_popup_grid_6_font_size: { label: 'Taille police Popup Réseau 6 (px)', helper: 'Taille de police pour la ligne 6 du popup réseau. Par défaut 16' },
          sensor_popup_inverter_1: { label: 'Popup Inverter 1', helper: 'Entité pour la ligne 1 du popup Inverter.' },
          sensor_popup_inverter_1_name: { label: 'Nom Popup Inverter 1', helper: 'Nom personnalisé optionnel pour la ligne 1 du popup Inverter. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_inverter_1_color: { label: 'Couleur Popup Inverter 1', helper: 'Couleur pour le texte de la ligne 1 du popup Inverter.' },
          sensor_popup_inverter_1_font_size: { label: 'Taille police Popup Inverter 1 (px)', helper: 'Taille de police pour la ligne 1 du popup Inverter. Par défaut 16' },
          sensor_popup_inverter_2: { label: 'Popup Inverter 2', helper: 'Entité pour la ligne 2 du popup Inverter.' },
          sensor_popup_inverter_2_name: { label: 'Nom Popup Inverter 2', helper: 'Nom personnalisé optionnel pour la ligne 2 du popup Inverter. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_inverter_2_color: { label: 'Couleur Popup Inverter 2', helper: 'Couleur pour le texte de la ligne 2 du popup Inverter.' },
          sensor_popup_inverter_2_font_size: { label: 'Taille police Popup Inverter 2 (px)', helper: 'Taille de police pour la ligne 2 du popup Inverter. Par défaut 16' },
          sensor_popup_inverter_3: { label: 'Popup Inverter 3', helper: 'Entité pour la ligne 3 du popup Inverter.' },
          sensor_popup_inverter_3_name: { label: 'Nom Popup Inverter 3', helper: 'Nom personnalisé optionnel pour la ligne 3 du popup Inverter. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_inverter_3_color: { label: 'Couleur Popup Inverter 3', helper: 'Couleur pour le texte de la ligne 3 du popup Inverter.' },
          sensor_popup_inverter_3_font_size: { label: 'Taille police Popup Inverter 3 (px)', helper: 'Taille de police pour la ligne 3 du popup Inverter. Par défaut 16' },
          sensor_popup_inverter_4: { label: 'Popup Inverter 4', helper: 'Entité pour la ligne 4 du popup Inverter.' },
          sensor_popup_inverter_4_name: { label: 'Nom Popup Inverter 4', helper: 'Nom personnalisé optionnel pour la ligne 4 du popup Inverter. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_inverter_4_color: { label: 'Couleur Popup Inverter 4', helper: 'Couleur pour le texte de la ligne 4 du popup Inverter.' },
          sensor_popup_inverter_4_font_size: { label: 'Taille police Popup Inverter 4 (px)', helper: 'Taille de police pour la ligne 4 du popup Inverter. Par défaut 16' },
          sensor_popup_inverter_5: { label: 'Popup Inverter 5', helper: 'Entité pour la ligne 5 du popup Inverter.' },
          sensor_popup_inverter_5_name: { label: 'Nom Popup Inverter 5', helper: 'Nom personnalisé optionnel pour la ligne 5 du popup Inverter. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_inverter_5_color: { label: 'Couleur Popup Inverter 5', helper: 'Couleur pour le texte de la ligne 5 du popup Inverter.' },
          sensor_popup_inverter_5_font_size: { label: 'Taille police Popup Inverter 5 (px)', helper: 'Taille de police pour la ligne 5 du popup Inverter. Par défaut 16' },
          sensor_popup_inverter_6: { label: 'Popup Inverter 6', helper: 'Entité pour la ligne 6 du popup Inverter.' },
          sensor_popup_inverter_6_name: { label: 'Nom Popup Inverter 6', helper: 'Nom personnalisé optionnel pour la ligne 6 du popup Inverter. Laisser vide pour utiliser le nom de l\'entité.' },
          sensor_popup_inverter_6_color: { label: 'Couleur Popup Inverter 6', helper: 'Couleur pour le texte de la ligne 6 du popup Inverter.' },
          sensor_popup_inverter_6_font_size: { label: 'Taille police Popup Inverter 6 (px)', helper: 'Taille de police pour la ligne 6 du popup Inverter. Par défaut 16' },
          dev_soc_bar_x: { label: 'Barre SOC X (px)', helper: 'Position horizontale. ViewBox 0–800. Path M 330,370 360,360 350,270 320,280 Z → 325.' },
          dev_soc_bar_y: { label: 'Barre SOC Y (px)', helper: 'Position verticale. ViewBox 0–450.' },
          dev_soc_bar_width: { label: 'Barre SOC Largeur (px)', helper: 'Largeur de la barre. Path bbox 30.' },
          dev_soc_bar_height: { label: 'Barre SOC Hauteur (px)', helper: 'Hauteur de la barre. Path bbox 85.' },
          dev_soc_bar_rotate: { label: 'Barre SOC Rotation (°)', helper: 'Rotation 0–360°. -180…180 pour cercle complet.' },
          dev_soc_bar_skew_x: { label: 'Barre SOC Inclinaison X (°)', helper: 'Angle d\'inclinaison horizontal en degrés.' },
          dev_soc_bar_skew_y: { label: 'Barre SOC Inclinaison Y (°)', helper: 'Angle d\'inclinaison vertical en degrés.' },
          soc_bar_opacity: { label: 'Barre SOC Opacité', helper: 'Transparence 0,05–1.' },
          soc_bar_glow: { label: 'Barre SOC Lueur (px)', helper: 'Flou drop-shadow sur segments allumés. 0 = off.' },
          soc_bar_color_on: { label: 'Barre SOC Couleur (allumé)', helper: 'Couleur du segment quand illuminé par SOC.' },
          soc_bar_color_off: { label: 'Barre SOC Couleur (éteint)', helper: 'Couleur du segment quand non illuminé.' },
          dev_grid_box_x: { label: 'Boîte Réseau X (px)', helper: 'Boîte en haut à droite. Import/Export + totaux journaliers.' },
          dev_grid_box_y: { label: 'Boîte Réseau Y (px)', helper: 'Position verticale.' },
          dev_grid_box_width: { label: 'Boîte Réseau Largeur (px)', helper: '' },
          dev_grid_box_height: { label: 'Boîte Réseau Hauteur (px)', helper: '' },
          dev_grid_box_font_size: { label: 'Boîte Réseau Taille police (px)', helper: 'Taille de police pour le texte. Vide = auto.' },
          dev_grid_box_text_color: { label: 'Boîte Réseau Couleur texte', helper: 'Couleur pour tout le texte. Vide = couleurs individuelles.' },
          dev_pv_box_x: { label: 'Boîte PV X (px)', helper: 'Boîte en haut à gauche. PV Total (somme) + Production journalière.' },
          dev_pv_box_y: { label: 'Boîte PV Y (px)', helper: 'Position verticale.' },
          dev_pv_box_width: { label: 'Boîte PV Largeur (px)', helper: '' },
          dev_pv_box_height: { label: 'Boîte PV Hauteur (px)', helper: '' },
          dev_pv_box_font_size: { label: 'Boîte PV Taille police (px)', helper: 'Taille de police pour le texte. Vide = auto.' },
          dev_pv_box_text_color: { label: 'Boîte PV Couleur texte', helper: 'Couleur pour tout le texte. Vide = couleur PV total.' },
          overlay_image_pro_1: { label: 'Image Overlay Pro 1', helper: 'Chemin vers l\'image overlay pro 1 (ex. /local/community/lumina-energy-card/overlay_pro_1.png).' },
          overlay_image_pro_2: { label: 'Image Overlay Pro 2', helper: 'Chemin vers l\'image overlay pro 2 (ex. /local/community/lumina-energy-card/overlay_pro_2.png).' },
          overlay_image_pro_3: { label: 'Image Overlay Pro 3', helper: 'Chemin vers l\'image overlay pro 3 (ex. /local/community/lumina-energy-card/overlay_pro_3.png).' },
          overlay_image_pro_4: { label: 'Image Overlay Pro 4', helper: 'Chemin vers l\'image overlay pro 4 (ex. /local/community/lumina-energy-card/overlay_pro_4.png).' },
          overlay_image_pro_5: { label: 'Image Overlay Pro 5', helper: 'Chemin vers l\'image overlay pro 5 (ex. /local/community/lumina-energy-card/overlay_pro_5.png).' },
        },
        options: {
          languages: [
            { value: 'en', label: 'Anglais' },
            { value: 'it', label: 'Italien' },
            { value: 'de', label: 'Allemand' },
            { value: 'fr', label: 'Français' },
            { value: 'nl', label: 'Néerlandais' }
          ],
          display_units: [
            { value: 'W', label: 'Watts (W)' },
            { value: 'kW', label: 'Kilowatts (kW)' }
          ],
          animation_styles: [
            { value: 'dashes', label: 'Tirets (par défaut)' },
            { value: 'dots', label: 'Points' },
            { value: 'arrows', label: 'Flèches' },
            { value: 'fluid_flow', label: 'Flux fluide' },
            { value: 'shimmer', label: 'Scintillement' }
          ]
        }
      ,
      view: {
        daily: 'PRODUCTION DU JOUR',
        pv_tot: 'PV TOTAL',
        car1: 'VÉHICULE 1',
        car2: 'VÉHICULE 2',
        importing: 'IMPORTATION',
        exporting: 'EXPORTATION'
      }
      },
      nl: {
        sections: {
          language: { title: 'Taal', helper: 'Kies de taal van de editor.' },
          installation_type: { title: 'Installatietype', helper: 'Selecteer uw installatietype om de kaart dienovereenkomstig te configureren.' },
          general: { title: 'Algemene instellingen', helper: 'Metadata van de kaart, achtergrond en update frequentie.' },
          array1: { title: 'Array 1', helper: 'Configureer PV Array 1 entiteiten.' },
          array2: { title: 'Array 2', helper: 'Als de Totale PV sensor (Inverter 2) is ingesteld of de PV String waarden zijn opgegeven, wordt Array 2 actief en wordt de tweede inverter ingeschakeld. U moet ook de Dagelijkse Productie Sensor (Array 2) en Huisbelasting (Inverter 2) inschakelen.' },
          battery: { title: 'Batterij', helper: 'Configureer batterij entiteiten.' },
          grid: { title: 'Grid/Huis', helper: 'Configureer grid en huis entiteiten.' },
          car: { title: 'Auto', helper: 'Configureer EV entiteiten.' },
          heatPump: { title: 'Warmtepomp', helper: 'Configureer warmtepomp vermogen entiteit. Stroom en tekst alleen zichtbaar als geconfigureerd.' },
          entities: { title: 'Entiteit selectie', helper: 'Kies de PV, batterij, grid, load en EV entiteiten gebruikt door de kaart. Of de totale PV sensor, of uw PV string arrays moeten minimaal worden gespecificeerd.' },
          house_management: { title: 'Huismanagement', helper: 'Koppel entiteiten aan Home-iconknoppen (camera\'s, lampen, temperatuur, beveiliging, vochtigheid). Maximaal 6 per pictogram. Klik op camera-icon opent stream-popup.' },
          pvPopup: { title: 'PV Popup', helper: 'Configureer entiteiten voor de PV popup weergave.' },
          housePopup: { title: 'Huis Popup', helper: 'Configureer entiteiten voor de huis popup weergave. Entiteiten zoals lampen, schakelaars en input_boolean tonen een toggle switch voor controle.' },
          batteryPopup: { title: 'Batterij-popup', helper: 'Configureer de batterij popup weergave.' },
          gridPopup: { title: 'Grid-popup', helper: 'Configureer entiteiten voor de grid popup weergave.' },
          inverterPopup: { title: 'Inverter-popup', helper: 'Configureer entiteiten voor de inverter popup weergave.' },
          colors: { title: 'Kleuren & Drempels', helper: 'Configureer netwerkdrempels en accentkleuren voor stromen en EV-weergave.' },
          flow_colors: { title: 'Stroomkleuren', helper: 'Configureer kleuren voor energie stroom animaties.' },
          animation_styles: { title: 'Animatietijlen', helper: 'Stroom animatiestijl (strepen, stippen, pijlen, glinsteren). Standaard: glinsteren.' },
          typography: { title: 'Typografie', helper: 'Pas de lettergrootte aan gebruikt in de kaart.' },
          flow_path_custom: { title: 'Aangepaste Stroompaden', helper: 'Pas stroompaden aan door SVG-padstrings te wijzigen. Laat leeg om standaardpaden te gebruiken. U kunt aangepaste paden combineren met offsets uit de Stroompad-sectie.' },
          lumina_pro: { title: 'Lumina PRO', helper: '⚠️ PRO-FUNCTIES: Premium functies inclusief overlay afbeeldingen, aangepaste stromen en aangepaste teksten. Om te ontgrendelen: stuur 1€ naar PayPal (3dprint8616@gmail.com) met uw e-mailadres in het bericht.' },
          layout: { title: 'Layout & Tekstposities', helper: 'Schuifregelaars tonen exacte X, Y (px) en hoeken (°). Step 1 voor precise waarden—noteer voor uw definitieve YAML. ViewBox 800×450. Opslaan en dashboard controleren. YAML: dev_text_*_x, _y, _rotate, _skewX, _skewY, _scaleX, _scaleY.' },
          socBar: { title: 'SOC-balk', helper: '6-segmenten balk op de batterij. Positie, dekking, gloed, kleuren.' },
          gridBox: { title: 'Netwerkbox', helper: 'Box rechtsboven: Import/Export + dagtotalen. Positie en grootte.' },
          pvBox: { title: 'PV-box', helper: 'Box linksboven: PV Totaal (som) + Dagproductie. Positie en grootte.' },
          batteryFill: { title: 'Batterij-vulling positie', helper: 'Schuifregelaars tonen exacte coördinaten (px) en hoeken (°). Noteer waarden voor definitieve YAML. YAML: dev_battery_fill_x, _y_base, _width, _max_height, _rotate, _skew_x, _skew_y.' },
          overlay_image: { title: 'Overlay Afbeelding', helper: 'Configureer een overlay PNG-afbeelding om boven de achtergrondafbeelding weer te geven. Gebruik schuifregelaars om de overlay te positioneren en te wijzigen.' },
          custom_flows: { title: 'Aangepaste Stromen', helper: 'Maak extra energiestromen door een sensor, SVG-pad, kleur en activeringsdrempel te definiëren. Handig voor het visualiseren van aangepaste energiebronnen of belastingen.' },
          about: { title: 'Over', helper: 'Credits, versie en nuttige links.' }
        },
        fields: {
          card_title: { label: 'Kaart titel', helper: 'Titel weergegeven bovenaan de kaart. Leeg laten om uit te schakelen.' },
          overlay_image_enabled: { label: 'Overlay afbeelding inschakelen', helper: 'Overlay afbeelding in- of uitschakelen.' },
          overlay_image: { label: 'Overlay afbeelding pad', helper: 'Pad naar een overlay PNG-afbeelding om boven de achtergrond weer te geven (bijv. /local/community/lumina-energy-card/overlay.png).' },
          overlay_image_x: { label: 'Overlay afbeelding X-positie (px)', helper: 'Horizontale positie van de overlay afbeelding. Standaard: 0.' },
          overlay_image_y: { label: 'Overlay afbeelding Y-positie (px)', helper: 'Verticale positie van de overlay afbeelding. Standaard: 0.' },
          overlay_image_width: { label: 'Overlay afbeelding breedte (px)', helper: 'Breedte van de overlay afbeelding. Standaard: 800.' },
          overlay_image_height: { label: 'Overlay afbeelding hoogte (px)', helper: 'Hoogte van de overlay afbeelding. Standaard: 450.' },
          overlay_image_opacity: { label: 'Overlay afbeelding doorzichtigheid', helper: 'Doorzichtigheid van de overlay afbeelding (0.0 tot 1.0). Standaard: 1.0.' },
          overlay_image_2_enabled: { label: 'Overlay afbeelding 2 inschakelen', helper: 'Tweede overlay afbeelding in- of uitschakelen.' },
          overlay_image_2: { label: 'Overlay afbeelding 2 pad', helper: 'Pad naar een tweede overlay PNG-afbeelding om boven de achtergrond weer te geven (bijv. /local/community/lumina-energy-card/overlay2.png).' },
          overlay_image_2_x: { label: 'Overlay afbeelding 2 X-positie (px)', helper: 'Horizontale positie van de tweede overlay afbeelding. Standaard: 0.' },
          overlay_image_2_y: { label: 'Overlay afbeelding 2 Y-positie (px)', helper: 'Verticale positie van de tweede overlay afbeelding. Standaard: 0.' },
          overlay_image_2_width: { label: 'Overlay afbeelding 2 breedte (px)', helper: 'Breedte van de tweede overlay afbeelding. Standaard: 800.' },
          overlay_image_2_height: { label: 'Overlay afbeelding 2 hoogte (px)', helper: 'Hoogte van de tweede overlay afbeelding. Standaard: 450.' },
          overlay_image_2_opacity: { label: 'Overlay afbeelding 2 doorzichtigheid', helper: 'Doorzichtigheid van de tweede overlay afbeelding (0.0 tot 1.0). Standaard: 1.0.' },
          overlay_image_3_enabled: { label: 'Overlay afbeelding 3 inschakelen', helper: 'Derde overlay afbeelding in- of uitschakelen.' },
          overlay_image_3: { label: 'Overlay afbeelding 3 pad', helper: 'Pad naar een derde overlay PNG-afbeelding om boven de achtergrond weer te geven (bijv. /local/community/lumina-energy-card/overlay3.png).' },
          overlay_image_3_x: { label: 'Overlay afbeelding 3 X-positie (px)', helper: 'Horizontale positie van de derde overlay afbeelding. Standaard: 0.' },
          overlay_image_3_y: { label: 'Overlay afbeelding 3 Y-positie (px)', helper: 'Verticale positie van de derde overlay afbeelding. Standaard: 0.' },
          overlay_image_3_width: { label: 'Overlay afbeelding 3 breedte (px)', helper: 'Breedte van de derde overlay afbeelding. Standaard: 800.' },
          overlay_image_3_height: { label: 'Overlay afbeelding 3 hoogte (px)', helper: 'Hoogte van de derde overlay afbeelding. Standaard: 450.' },
          overlay_image_3_opacity: { label: 'Overlay afbeelding 3 doorzichtigheid', helper: 'Doorzichtigheid van de derde overlay afbeelding (0.0 tot 1.0). Standaard: 1.0.' },
          overlay_image_4_enabled: { label: 'Overlay afbeelding 4 inschakelen', helper: 'Vierde overlay afbeelding in- of uitschakelen.' },
          overlay_image_4: { label: 'Overlay afbeelding 4 pad', helper: 'Pad naar een vierde overlay PNG-afbeelding om boven de achtergrond weer te geven (bijv. /local/community/lumina-energy-card/overlay4.png).' },
          overlay_image_4_x: { label: 'Overlay afbeelding 4 X-positie (px)', helper: 'Horizontale positie van de vierde overlay afbeelding. Standaard: 0.' },
          overlay_image_4_y: { label: 'Overlay afbeelding 4 Y-positie (px)', helper: 'Verticale positie van de vierde overlay afbeelding. Standaard: 0.' },
          overlay_image_4_width: { label: 'Overlay afbeelding 4 breedte (px)', helper: 'Breedte van de vierde overlay afbeelding. Standaard: 800.' },
          overlay_image_4_height: { label: 'Overlay afbeelding 4 hoogte (px)', helper: 'Hoogte van de vierde overlay afbeelding. Standaard: 450.' },
          overlay_image_4_opacity: { label: 'Overlay afbeelding 4 doorzichtigheid', helper: 'Doorzichtigheid van de vierde overlay afbeelding (0.0 tot 1.0). Standaard: 1.0.' },
          overlay_image_5_enabled: { label: 'Overlay afbeelding 5 inschakelen', helper: 'Vijfde overlay afbeelding in- of uitschakelen.' },
          overlay_image_5: { label: 'Overlay afbeelding 5 pad', helper: 'Pad naar een vijfde overlay PNG-afbeelding om boven de achtergrond weer te geven (bijv. /local/community/lumina-energy-card/overlay5.png).' },
          overlay_image_5_x: { label: 'Overlay afbeelding 5 X-positie (px)', helper: 'Horizontale positie van de vijfde overlay afbeelding. Standaard: 0.' },
          overlay_image_5_y: { label: 'Overlay afbeelding 5 Y-positie (px)', helper: 'Verticale positie van de vijfde overlay afbeelding. Standaard: 0.' },
          overlay_image_5_width: { label: 'Overlay afbeelding 5 breedte (px)', helper: 'Breedte van de vijfde overlay afbeelding. Standaard: 800.' },
          overlay_image_5_height: { label: 'Overlay afbeelding 5 hoogte (px)', helper: 'Hoogte van de vijfde overlay afbeelding. Standaard: 450.' },
          overlay_image_5_opacity: { label: 'Overlay afbeelding 5 doorzichtigheid', helper: 'Doorzichtigheid van de vijfde overlay afbeelding (0.0 tot 1.0). Standaard: 1.0.' },
          language: { label: 'Taal', helper: 'Kies de taal van de editor.' },
          display_unit: { label: 'Weergave eenheid', helper: 'Eenheid gebruikt om kracht waarden te formatteren.' },
          update_interval: { label: 'Update interval', helper: 'Frequentie van kaart updates verversen (0 schakelt throttling uit).' },
          animation_speed_factor: { label: 'Animatie snelheid factor', helper: 'Pas de animatie snelheid multiplier aan (-3x tot 3x). Stel in op 0 voor pauze; negatieven keren richting om.' },
          animation_style: { label: 'Animatie stijl', helper: 'Kies het patroon voor flow animaties (strepen, stippen, pijlen of shimmer).' },
          flow_stroke_width: { label: 'Flow lijnbreedte (px)', helper: 'Optionele overschrijving voor de geanimeerde flow lijnbreedte (geen SVG-bewerkingen). Laat leeg om SVG-standaardwaarden te behouden.' },
          
          // Flow Path offsets
          pv1_flow_offset_x: { label: 'PV1 Stroom Offset X (px)', helper: 'Horizontale offset voor PV1 stroompad. Positief = rechts, negatief = links.' },
          pv1_flow_offset_y: { label: 'PV1 Stroom Offset Y (px)', helper: 'Verticale offset voor PV1 stroompad. Positief = omlaag, negatief = omhoog.' },
          pv2_flow_offset_x: { label: 'PV2 Stroom Offset X (px)', helper: 'Horizontale offset voor PV2 stroompad. Positief = rechts, negatief = links.' },
          pv2_flow_offset_y: { label: 'PV2 Stroom Offset Y (px)', helper: 'Verticale offset voor PV2 stroompad. Positief = omlaag, negatief = omhoog.' },
          bat_flow_offset_x: { label: 'Batterij Stroom Offset X (px)', helper: 'Horizontale offset voor batterij stroompad. Positief = rechts, negatief = links.' },
          bat_flow_offset_y: { label: 'Batterij Stroom Offset Y (px)', helper: 'Verticale offset voor batterij stroompad. Positief = omlaag, negatief = omhoog.' },
          load_flow_offset_x: { label: 'Verbruik Stroom Offset X (px)', helper: 'Horizontale offset voor verbruik stroompad. Positief = rechts, negatief = links.' },
          load_flow_offset_y: { label: 'Verbruik Stroom Offset Y (px)', helper: 'Verticale offset voor verbruik stroompad. Positief = omlaag, negatief = omhoog.' },
          grid_flow_offset_x: { label: 'Netwerk Stroom Offset X (px)', helper: 'Horizontale offset voor netwerk stroompad. Positief = rechts, negatief = links.' },
          grid_flow_offset_y: { label: 'Netwerk Stroom Offset Y (px)', helper: 'Verticale offset voor netwerk stroompad. Positief = omlaag, negatief = omhoog.' },
          grid_house_flow_offset_x: { label: 'Netwerk-Huis Stroom Offset X (px)', helper: 'Horizontale offset voor netwerk-huis stroompad. Positief = rechts, negatief = links.' },
          grid_house_flow_offset_y: { label: 'Netwerk-Huis Stroom Offset Y (px)', helper: 'Verticale offset voor netwerk-huis stroompad. Positief = omlaag, negatief = omhoog.' },
          car1_flow_offset_x: { label: 'Voertuig1 Stroom Offset X (px)', helper: 'Horizontale offset voor voertuig1 stroompad. Positief = rechts, negatief = links.' },
          car1_flow_offset_y: { label: 'Voertuig1 Stroom Offset Y (px)', helper: 'Verticale offset voor voertuig1 stroompad. Positief = omlaag, negatief = omhoog.' },
          car2_flow_offset_x: { label: 'Voertuig2 Stroom Offset X (px)', helper: 'Horizontale offset voor voertuig2 stroompad. Positief = rechts, negatief = links.' },
          car2_flow_offset_y: { label: 'Voertuig2 Stroom Offset Y (px)', helper: 'Verticale offset voor voertuig2 stroompad. Positief = omlaag, negatief = omhoog.' },
          heat_pump_flow_offset_x: { label: 'Warmtepomp Stroom Offset X (px)', helper: 'Horizontale offset voor warmtepomp stroompad. Positief = rechts, negatief = links.' },
          heat_pump_flow_offset_y: { label: 'Warmtepomp Stroom Offset Y (px)', helper: 'Verticale offset voor warmtepomp stroompad. Positief = omlaag, negatief = omhoog.' },
          
          // Custom Flow Paths (SVG path strings)
          pv1_flow_path: { label: 'PV1 Stroompad (SVG)', helper: `Aangepaste SVG-padstring voor PV1 stroompad. Laat leeg om standaard te gebruiken. Standaard: ${FLOW_PATHS.pv1}` },
          pv2_flow_path: { label: 'PV2 Stroompad (SVG)', helper: `Aangepaste SVG-padstring voor PV2 stroompad. Laat leeg om standaard te gebruiken. Standaard: ${FLOW_PATHS.pv2}` },
          bat_flow_path: { label: 'Batterij Stroompad (SVG)', helper: `Aangepaste SVG-padstring voor batterij stroompad. Laat leeg om standaard te gebruiken. Standaard: ${FLOW_PATHS.bat}` },
          load_flow_path: { label: 'Verbruik Stroompad (SVG)', helper: `Aangepaste SVG-padstring voor verbruik stroompad. Laat leeg om standaard te gebruiken. Standaard: ${FLOW_PATHS.load}` },
          grid_flow_path: { label: 'Netwerk Stroompad (SVG)', helper: `Aangepaste SVG-padstring voor netwerk stroompad. Laat leeg om standaard te gebruiken. Standaard: ${FLOW_PATHS.grid}` },
          grid_house_flow_path: { label: 'Netwerk-Huis Stroompad (SVG)', helper: `Aangepaste SVG-padstring voor netwerk-huis stroompad. Laat leeg om standaard te gebruiken. Standaard: ${FLOW_PATHS.grid_house}` },
          car1_flow_path: { label: 'Voertuig1 Stroompad (SVG)', helper: `Aangepaste SVG-padstring voor voertuig1 stroompad. Laat leeg om standaard te gebruiken. Standaard: ${FLOW_PATHS.car1}` },
          car2_flow_path: { label: 'Voertuig2 Stroompad (SVG)', helper: `Aangepaste SVG-padstring voor voertuig2 stroompad. Laat leeg om standaard te gebruiken. Standaard: ${FLOW_PATHS.car2}` },
          heat_pump_flow_path: { label: 'Warmtepomp Stroompad (SVG)', helper: `Aangepaste SVG-padstring voor warmtepomp stroompad. Laat leeg om standaard te gebruiken. Standaard: ${FLOW_PATHS.heatPump}` },
          
          sensor_pv_total: { label: 'Totale PV sensor', helper: 'Optionele geaggregeerde productie sensor weergegeven als gecombineerde lijn.' },
          sensor_pv_total_secondary: { label: 'Totale PV sensor (Inverter 2)', helper: 'Tweede optionele inverter sensor; toegevoegd aan totale PV indien opgegeven.' },
          sensor_pv1: { label: 'PV String 1 (Array 1)', helper: 'Primaire zonne productie sensor.' },
          sensor_pv2: { label: 'PV String 2 (Array 1)' },
          sensor_pv3: { label: 'PV String 3 (Array 1)' },
          sensor_pv4: { label: 'PV String 4 (Array 1)' },
          sensor_pv5: { label: 'PV String 5 (Array 1)' },
          sensor_pv6: { label: 'PV String 6 (Array 1)' },
          sensor_pv_array2_1: { label: 'PV String 1 (Array 2)', helper: 'Zonne productie sensor voor Array 2.' },
          sensor_pv_array2_2: { label: 'PV String 2 (Array 2)', helper: 'Zonne productie sensor voor Array 2.' },
          sensor_pv_array2_3: { label: 'PV String 3 (Array 2)', helper: 'Zonne productie sensor voor Array 2.' },
          sensor_pv_array2_4: { label: 'PV String 4 (Array 2)', helper: 'Zonne productie sensor voor Array 2.' },
          sensor_pv_array2_5: { label: 'PV String 5 (Array 2)', helper: 'Zonne productie sensor voor Array 2.' },
          sensor_pv_array2_6: { label: 'PV String 6 (Array 2)', helper: 'Zonne productie sensor voor Array 2.' },
          show_pv_strings: { label: 'Toon individuele PV strings', helper: 'Inschakelen om de totale lijn plus elke PV string op aparte lijnen weer te geven.' },
          sensor_daily: { label: 'Dagelijkse productie sensor (Vereist)', helper: 'Sensor die dagelijkse productie totalen aangeeft. Of de totale PV sensor, of uw PV string arrays moeten minimaal worden gespecificeerd.' },
          sensor_daily_array2: { label: 'Dagelijkse productie sensor (Array 2)', helper: 'Sensor voor dagelijkse productie totalen van Array 2.' },
          sensor_bat1_soc: { label: 'Batterij 1 SOC' },
          sensor_bat1_power: { label: 'Batterij 1 vermogen' },
          sensor_bat2_soc: { label: 'Batterij 2 SOC' },
          sensor_bat2_power: { label: 'Batterij 2 vermogen' },
          sensor_bat3_soc: { label: 'Batterij 3 SOC' },
          sensor_bat3_power: { label: 'Batterij 3 vermogen' },
          sensor_bat4_soc: { label: 'Batterij 4 SOC' },
          sensor_bat4_power: { label: 'Batterij 4 vermogen' },
          battery_power_mode: { label: 'Batterij vermogenmodus', helper: 'Flow: enkele sensor met teken (+ = laden → batterij, - = ontladen → omvormer). Laden+Ontladen: aparte sensoren; laden = stroom naar batterij, ontladen = stroom naar omvormer.' },
          sensor_battery_flow: { label: 'Batterij Flow (met teken)', helper: 'Optioneel. Enkele vermogenssensor: positief = laden (stroom naar batterij), negatief = ontladen (stroom naar omvormer). Modus Flow. Leeg = Bat 1–4 vermogen.' },
          sensor_battery_charge: { label: 'Batterij laden', helper: 'Vermogenssensor bij laden. Stroom naar batterij. Modus Laden+Ontladen.' },
          sensor_battery_discharge: { label: 'Batterij ontladen', helper: 'Vermogenssensor bij ontladen. Stroom naar omvormer. Modus Laden+Ontladen.' },
          sensor_home_load: { label: 'Huisbelasting/verbruik (Vereist)', helper: 'Sensor voor totale huisverbruik.' },
          sensor_home_load_secondary: { label: 'Huisbelasting (Inverter 2)', helper: 'Optionele huisbelasting sensor voor de tweede inverter.' },
          sensor_heat_pump_consumption: { label: 'Warmtepomp verbruik', helper: 'Sensor voor energieverbruik van de warmtepomp.' },
          sensor_house_temperature: { label: 'Huis temperatuursensor', helper: 'Temperatuursensor weergegeven op het huis met hi-tech odometer effect.' },
          house_temperature_offset_x: { label: 'Temperatuur Offset X', helper: 'Horizontale offset voor de temperatuurweergave (in pixels).' },
          house_temperature_offset_y: { label: 'Temperatuur Offset Y', helper: 'Verticale offset voor de temperatuurweergave (in pixels).' },
          house_temperature_rotation: { label: 'Temperatuur Rotatie', helper: 'Rotatiehoek voor de temperatuurweergave (in graden, van -360 tot 360).' },
          sensor_grid_power: { label: 'Grid vermogen', helper: 'Sensor voor grid flow positief/negatief. Specificeer of deze sensor of de Grid Import/Export sensoren.' },
          sensor_grid_import: { label: 'Grid import sensor', helper: 'Optionele entiteit die grid import rapporteert (positieve waarden).' },
          sensor_grid_export: { label: 'Grid export sensor', helper: 'Optionele entiteit die grid export rapporteert (positieve waarden).' },
          sensor_grid_import_daily: { label: 'Dagelijkse grid import sensor', helper: 'Optionele entiteit die cumulatieve grid import voor de huidige dag rapporteert.' },
          sensor_grid_export_daily: { label: 'Dagelijkse grid export sensor', helper: 'Optionele entiteit die cumulatieve grid export voor de huidige dag rapporteert.' },
          pv_tot_color: { label: 'Totale PV kleur', helper: 'Kleur toegepast op de PV TOTAL lijn/tekst.' },
          pv_primary_color: { label: 'PV Flow 1 kleur', helper: 'Kleur gebruikt voor de primaire PV animatie lijn.' },
          pv_secondary_color: { label: 'PV Flow 2 kleur', helper: 'Kleur gebruikt voor de secundaire PV animatie lijn indien beschikbaar.' },
          pv_text_color: { label: 'PV tekst kleur', helper: 'Kleur voor PV/Solar labels (Array 1).' },
          pv_font_size: { label: 'PV lettergrootte (px)', helper: 'Lettergrootte voor PV tekst (Array 1).' },
          pv_secondary_text_color: { label: 'Array 2 tekst kleur', helper: 'Kleur voor Array 2 tekst labels.' },
          pv_secondary_font_size: { label: 'Array 2 lettergrootte (px)', helper: 'Lettergrootte voor Array 2 tekst.' },
          pv_string1_color: { label: 'PV String 1 kleur', helper: 'Vervang kleur voor S1 in PV lijst. Leeg laten om te erven van totale PV kleur.' },
          pv_string2_color: { label: 'PV String 2 kleur', helper: 'Vervang kleur voor S2 in PV lijst. Leeg laten om te erven van totale PV kleur.' },
          pv_string3_color: { label: 'PV String 3 kleur', helper: 'Vervang kleur voor S3 in PV lijst. Leeg laten om te erven van totale PV kleur.' },
          pv_string4_color: { label: 'PV String 4 kleur', helper: 'Vervang kleur voor S4 in PV lijst. Leeg laten om te erven van totale PV kleur.' },
          pv_string5_color: { label: 'PV String 5 kleur', helper: 'Vervang kleur voor S5 in PV lijst. Leeg laten om te erven van totale PV kleur.' },
          pv_string6_color: { label: 'PV String 6 kleur', helper: 'Vervang kleur voor S6 in PV lijst. Leeg laten om te erven van totale PV kleur.' },
          load_flow_color: { label: 'Belasting flow kleur', helper: 'Kleur toegepast op de huisbelasting animatie lijn.' },
          load_text_color: { label: 'Belasting tekstkleur', helper: 'Kleur toegepast op de tekst van het huisverbruik wanneer geen drempel actief is.' },
          inv1_color: { label: 'INV 1 kleur', helper: 'Kleur toegepast op INV 1 tekst/flow.' },
          inv2_color: { label: 'INV 2 kleur', helper: 'Kleur toegepast op INV 2 tekst/flow.' },
          load_threshold_warning: { label: 'Belasting waarschuwingsdrempel', helper: 'Verander kleur van lader wanneer magnitude deze waarde bereikt of overschrijdt. Gebruikt geselecteerde weergave eenheid.' },
          load_warning_color: { label: 'Belasting waarschuwingskleur', helper: 'Hex of CSS kleur toegepast op belasting waarschuwingsdrempel.' },
          load_threshold_critical: { label: 'Belasting kritieke drempel', helper: 'Verander kleur wanneer magnitude deze waarde bereikt of overschrijdt. Gebruikt geselecteerde weergave eenheid.' },
          load_critical_color: { label: 'Belasting kritieke kleur', helper: 'Hex of CSS kleur toegepast op kritieke belasting drempel.' },
          battery_soc_color: { label: 'Batterij SOC kleur', helper: 'Kleur toegepast op de batterij-SOC-percentagetekst.' },
          battery_charge_color: { label: 'Batterij laad flow kleur', helper: 'Kleur gebruikt wanneer energie de batterij ingaat.' },
          battery_discharge_color: { label: 'Batterij ontlaad flow kleur', helper: 'Kleur gebruikt wanneer energie de batterij verlaat.' },
          battery_fill_opacity: { label: 'Batterij vulling opacity', helper: 'Transparantie van de batterijvloeistof (0,05–1).' },
          grid_activity_threshold: { label: 'Grid animatie drempel (W)', helper: 'Negeer grid flows waarvan absolute waarde lager is dan deze kracht voordat animeren.' },
          grid_threshold_warning: { label: 'Grid waarschuwingsdrempel', helper: 'Verander grid kleur wanneer magnitude deze waarde bereikt. Gebruikt geselecteerde weergave eenheid.' },
          grid_warning_color: { label: 'Grid waarschuwingskleur', helper: 'Hex kleur toegepast op waarschuwingsdrempel.' },
          grid_threshold_critical: { label: 'Grid kritieke drempel', helper: 'Verander grid kleur wanneer magnitude deze waarde bereikt. Gebruikt geselecteerde weergave eenheid.' },
          grid_critical_color: { label: 'Grid kritieke kleur', helper: 'Kleur toegepast op kritieke drempel.' },
          invert_grid: { label: 'Grid waarden omkeren', helper: 'Inschakelen als import/export polariteit omgekeerd is.' },
          enable_echo_alive: { label: 'Echo Alive inschakelen', helper: 'Schakelt een onzichtbare iframe in om de Silk-browser open te houden op Echo Show. De knop wordt in een hoek van de kaart geplaatst.' },
          enable_text_toggle_button: { label: 'Tekst Toggle Knop Inschakelen', helper: 'Toont een knop op de kaart om tekstzichtbaarheid aan/uit te schakelen.' },
          text_toggle_button_x: { label: 'Tekst Toggle Knop X (px)', helper: 'Horizontale positie van de tekst toggle knop. Afstand van de linkerrand in pixels. Standaard: 10px (onder-links).' },
          text_toggle_button_y: { label: 'Tekst Toggle Knop Y (px)', helper: 'Verticale positie vanaf boven in pixels. Laat leeg om onderaan te positioneren. Standaard: onderaan.' },
          text_toggle_button_scale: { label: 'Tekst Toggle Knop Schaal', helper: 'Schaalfactor voor knopgrootte (0.5 tot 2.0). 1.0 = standaardgrootte.' },
          text_visibility_sensor: { label: 'Tekst Zichtbaarheid Bewegingssensor (PRO)', helper: '⚠️ PRO-FUNCTIE: Bewegingssensor entiteit. Wanneer beweging wordt gedetecteerd, verschijnen de teksten. Perfect voor wandtablets met camera.' },
          solar_forecast_enabled: { label: 'Zonnevoorspelling inschakelen', helper: '⚠️ PRO-FUNCTIE: Toont geschatte zonneproductie met zonstatus (veel/matig/weinig zon).' },
          sensor_solar_forecast: { label: 'Zonnevoorspelling Sensor', helper: 'Sensor entiteit voor geschatte zonneproductie (in W of kW).' },
          solar_forecast_max_power: { label: 'Zonnevoorspelling Max. Vermogen (W)', helper: 'Maximaal verwacht vermogen in watt. Gebruikt om percentage te berekenen voor zonstatus (standaard: 10000W).' },
          solar_forecast_x: { label: 'Zonnevoorspelling X Positie (px)', helper: 'Horizontale positie van de zonnevoorspelling tekst (in pixels).' },
          solar_forecast_y: { label: 'Zonnevoorspelling Y Positie (px)', helper: 'Verticale positie van de zonnevoorspelling tekst (in pixels).' },
          solar_forecast_color: { label: 'Zonnevoorspelling Kleur', helper: 'Kleur voor de zonnevoorspelling tekst (standaard: #00FFFF).' },
          solar_forecast_size: { label: 'Zonnevoorspelling Lettergrootte (px)', helper: 'Lettergrootte voor de zonnevoorspelling tekst (standaard: 16px).' },
          invert_battery: { label: 'Batterij waarden omkeren', helper: 'Inschakelen als laad/ontlaad polariteit omgekeerd is.' },
          sensor_car_power: { label: 'Voertuig 1 vermogen sensor' },
          sensor_car_soc: { label: 'Voertuig 1 SOC sensor' },
          car_soc: { label: 'Voertuig SOC', helper: 'Sensor voor EV batterij SOC.' },
          car_range: { label: 'Voertuig bereik', helper: 'Sensor voor EV bereik.' },
          car_efficiency: { label: 'Voertuig efficiëntie', helper: 'Sensor voor EV efficiëntie.' },
          car_charger_power: { label: 'Voertuig lader vermogen', helper: 'Sensor voor EV lader vermogen.' },
          car1_label: { label: 'Voertuig 1 label', helper: 'Tekst weergegeven naast de waarden van de eerste EV.' },
          sensor_car2_power: { label: 'Voertuig 2 vermogen sensor' },
          sensor_car2_soc: { label: 'Voertuig 2 SOC sensor' },
          car2_soc: { label: 'Voertuig 2 SOC', helper: 'Sensor voor EV 2 batterij SOC.' },
          car2_range: { label: 'Voertuig 2 bereik', helper: 'Sensor voor EV 2 bereik.' },
          car2_efficiency: { label: 'Voertuig 2 efficiëntie', helper: 'Sensor voor EV 2 efficiëntie.' },
          car2_charger_power: { label: 'Voertuig 2 lader vermogen', helper: 'Sensor voor EV 2 lader vermogen.' },
          car2_power: { label: 'Voertuig 2 vermogen', helper: 'Sensor voor EV 2 laad/ontlaad vermogen.' },
          car2_label: { label: 'Voertuig 2 label', helper: 'Tekst weergegeven naast de waarden van de tweede EV.' },
          show_car_soc: { label: 'Toon Voertuig 1', helper: 'Inschakelen om metrics van het eerste voertuig weer te geven.' },
          show_car2: { label: 'Toon Voertuig 2', helper: 'Inschakelen om metrics van het tweede voertuig weer te geven wanneer sensoren zijn opgegeven.' },
          car1_bidirectional: { label: 'Bidirectionele capaciteit Voertuig 1', helper: 'Inschakelen als Voertuig 1 V2X-capaciteit heeft (kan opladen en ontladen zoals een thuisbatterij).' },
          car2_bidirectional: { label: 'Bidirectionele capaciteit Voertuig 2', helper: 'Inschakelen als Voertuig 2 V2X-capaciteit heeft (kan opladen en ontladen zoals een thuisbatterij).' },
          car1_invert_flow: { label: 'Stroom Omkeren Voertuig 1', helper: 'Keert de stroomrichting voor Voertuig 1 om. Handig als de sensorpolariteit omgekeerd is.' },
          car2_invert_flow: { label: 'Stroom Omkeren Voertuig 2', helper: 'Keert de stroomrichting voor Voertuig 2 om. Handig als de sensorpolariteit omgekeerd is.' },
          array1_invert_flow: { label: 'Stroom Omkeren Array 1', helper: 'Keert de stroomrichting voor Array 1 (PV1) om. Handig als de sensorpolariteit omgekeerd is.' },
          array2_invert_flow: { label: 'Stroom Omkeren Array 2', helper: 'Keert de stroomrichting voor Array 2 (PV2) om. Handig als de sensorpolariteit omgekeerd is.' },
          car_pct_color: { label: 'Voertuig SOC kleur', helper: 'Hex kleur voor EV SOC tekst (bijv. #00FFFF).' },
          car2_pct_color: { label: 'Voertuig 2 SOC kleur', helper: 'Hex kleur voor tweede EV SOC (valt terug op Voertuig SOC indien leeg).' },
          car1_name_color: { label: 'Voertuig 1 naam kleur', helper: 'Kleur toegepast op Voertuig 1 naam label.' },
          car2_name_color: { label: 'Voertuig 2 naam kleur', helper: 'Kleur toegepast op Voertuig 2 naam label.' },
          car1_color: { label: 'Voertuig 1 kleur', helper: 'Kleur toegepast op Voertuig 1 vermogen waarde.' },
          car2_color: { label: 'Voertuig 2 kleur', helper: 'Kleur toegepast op de vermogenswaarde van voertuig 2.' },
          pro_password: { label: 'PRO-wachtwoord', helper: '⚠️ PRO-FUNCTIE: Dit is een premium-functie.' },
          paypal_button: 'PRO-functies ontgrendelen (1€)',
          paypal_note: 'BELANGRIJK: Alleen als DONATIE sturen. Gebruik geen "Goederen en diensten". Vermeld je E-MAIL in de PayPal-notities om het wachtwoord te ontvangen.',
          overlay_image_enabled: { label: 'Overlay-afbeelding inschakelen', helper: 'Schakel de aangepaste overlay-afbeelding in of uit (vereist PRO-autorisatie).' },
          heat_pump_flow_color: { label: 'Warmtepomp stroom kleur', helper: 'Kleur toegepast op de warmtepomp stroom animatie.' },
          heat_pump_text_color: { label: 'Warmtepomp tekst kleur', helper: 'Kleur toegepast op de warmtepomp vermogen tekst.' },
          header_font_size: { label: 'Header lettergrootte (px)', helper: 'Standaard 16' },
          daily_label_font_size: { label: 'Dagelijks label lettergrootte (px)', helper: 'Standaard 12' },
          daily_value_font_size: { label: 'Dagelijks waarde lettergrootte (px)', helper: 'Standaard 20' },
          pv_font_size: { label: 'PV lettergrootte (px)', helper: 'Standaard 16' },
          battery_soc_font_size: { label: 'Batterij SOC lettergrootte (px)', helper: 'Standaard 20' },
          battery_power_font_size: { label: 'Batterij vermogen lettergrootte (px)', helper: 'Standaard 16' },
          load_font_size: { label: 'Belasting lettergrootte (px)', helper: 'Standaard 15' },
          heat_pump_font_size: { label: 'Warmtepomp lettergrootte (px)', helper: 'Standaard 16' },
          grid_font_size: { label: 'Grid lettergrootte (px)', helper: 'Standaard 15' },
          car_power_font_size: { label: 'Voertuig vermogen lettergrootte (px)', helper: 'Standaard 15' },
          car2_power_font_size: { label: 'Voertuig 2 vermogen lettergrootte (px)', helper: 'Standaard 15' },
          car_name_font_size: { label: 'Voertuig naam lettergrootte (px)', helper: 'Standaard 15' },
          car2_name_font_size: { label: 'Voertuig 2 naam lettergrootte (px)', helper: 'Standaard 15' },
          car_soc_font_size: { label: 'Voertuig SOC lettergrootte (px)', helper: 'Standaard 12' },
          car2_soc_font_size: { label: 'Voertuig 2 SOC lettergrootte (px)', helper: 'Standaard 12' },
          sensor_popup_pv_1: { label: 'PV Popup 1', helper: 'Entiteit voor PV popup lijn 1.' },
          sensor_popup_pv_2: { label: 'PV Popup 2', helper: 'Entiteit voor PV popup lijn 2.' },
          sensor_popup_pv_3: { label: 'PV Popup 3', helper: 'Entiteit voor PV popup lijn 3.' },
          sensor_popup_pv_4: { label: 'PV Popup 4', helper: 'Entiteit voor PV popup lijn 4.' },
          sensor_popup_pv_5: { label: 'PV Popup 5', helper: 'Entiteit voor PV popup lijn 5.' },
          sensor_popup_pv_6: { label: 'PV Popup 6', helper: 'Entiteit voor PV popup lijn 6.' },
          sensor_popup_pv_1_name: { label: 'Naam PV Popup 1', helper: 'Optionele aangepaste naam voor PV popup lijn 1. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_pv_2_name: { label: 'Naam PV Popup 2', helper: 'Optionele aangepaste naam voor PV popup lijn 2. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_pv_3_name: { label: 'Naam PV Popup 3', helper: 'Optionele aangepaste naam voor PV popup lijn 3. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_pv_4_name: { label: 'Naam PV Popup 4', helper: 'Optionele aangepaste naam voor PV popup lijn 4. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_pv_5_name: { label: 'Naam PV Popup 5', helper: 'Optionele aangepaste naam voor PV popup lijn 5. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_pv_6_name: { label: 'Naam PV Popup 6', helper: 'Optionele aangepaste naam voor PV popup lijn 6. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_pv_1_color: { label: 'Kleur PV Popup 1', helper: 'Kleur voor PV popup lijn 1 tekst.' },
          sensor_popup_pv_2_color: { label: 'Kleur PV Popup 2', helper: 'Kleur voor PV popup lijn 2 tekst.' },
          sensor_popup_pv_3_color: { label: 'Kleur PV Popup 3', helper: 'Kleur voor PV popup lijn 3 tekst.' },
          sensor_popup_pv_4_color: { label: 'Kleur PV Popup 4', helper: 'Kleur voor PV popup lijn 4 tekst.' },
          sensor_popup_pv_5_color: { label: 'Kleur PV Popup 5', helper: 'Kleur voor PV popup lijn 5 tekst.' },
          sensor_popup_pv_6_color: { label: 'Kleur PV Popup 6', helper: 'Kleur voor PV popup lijn 6 tekst.' },
          sensor_popup_pv_1_font_size: { label: 'Lettergrootte PV Popup 1 (px)', helper: 'Lettergrootte voor PV popup lijn 1. Standaard 16' },
          sensor_popup_pv_2_font_size: { label: 'Lettergrootte PV Popup 2 (px)', helper: 'Lettergrootte voor PV popup lijn 2. Standaard 16' },
          sensor_popup_pv_3_font_size: { label: 'Lettergrootte PV Popup 3 (px)', helper: 'Lettergrootte voor PV popup lijn 3. Standaard 16' },
          sensor_popup_pv_4_font_size: { label: 'Lettergrootte PV Popup 4 (px)', helper: 'Lettergrootte voor PV popup lijn 4. Standaard 16' },
          sensor_popup_pv_5_font_size: { label: 'Lettergrootte PV Popup 5 (px)', helper: 'Lettergrootte voor PV popup lijn 5. Standaard 16' },
          sensor_popup_pv_6_font_size: { label: 'Lettergrootte PV Popup 6 (px)', helper: 'Lettergrootte voor PV popup lijn 6. Standaard 16' },
          sensor_popup_house_1: { label: 'Huis Popup 1', helper: 'Entiteit voor huis popup lijn 1.' },
          sensor_popup_house_1_name: { label: 'Naam Huis Popup 1', helper: 'Optionele aangepaste naam voor huis popup lijn 1. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_house_1_color: { label: 'Kleur Huis Popup 1', helper: 'Kleur voor huis popup lijn 1 tekst.' },
          sensor_popup_house_1_font_size: { label: 'Lettergrootte Huis Popup 1 (px)', helper: 'Lettergrootte voor huis popup lijn 1. Standaard 16' },
          sensor_popup_house_2: { label: 'Huis Popup 2', helper: 'Entiteit voor huis popup lijn 2.' },
          sensor_popup_house_2_name: { label: 'Naam Huis Popup 2', helper: 'Optionele aangepaste naam voor huis popup lijn 2. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_house_2_color: { label: 'Kleur Huis Popup 2', helper: 'Kleur voor huis popup lijn 2 tekst.' },
          sensor_popup_house_2_font_size: { label: 'Lettergrootte Huis Popup 2 (px)', helper: 'Lettergrootte voor huis popup lijn 2. Standaard 16' },
          sensor_popup_house_3: { label: 'Huis Popup 3', helper: 'Entiteit voor huis popup lijn 3.' },
          sensor_popup_house_3_name: { label: 'Naam Huis Popup 3', helper: 'Optionele aangepaste naam voor huis popup lijn 3. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_house_3_color: { label: 'Kleur Huis Popup 3', helper: 'Kleur voor huis popup lijn 3 tekst.' },
          sensor_popup_house_3_font_size: { label: 'Lettergrootte Huis Popup 3 (px)', helper: 'Lettergrootte voor huis popup lijn 3. Standaard 16' },
          sensor_popup_house_4: { label: 'Huis Popup 4', helper: 'Entiteit voor huis popup lijn 4.' },
          sensor_popup_house_4_name: { label: 'Naam Huis Popup 4', helper: 'Optionele aangepaste naam voor huis popup lijn 4. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_house_4_color: { label: 'Kleur Huis Popup 4', helper: 'Kleur voor huis popup lijn 4 tekst.' },
          sensor_popup_house_4_font_size: { label: 'Lettergrootte Huis Popup 4 (px)', helper: 'Lettergrootte voor huis popup lijn 4. Standaard 16' },
          sensor_popup_house_5: { label: 'Huis Popup 5', helper: 'Entiteit voor huis popup lijn 5.' },
          sensor_popup_house_5_name: { label: 'Naam Huis Popup 5', helper: 'Optionele aangepaste naam voor huis popup lijn 5. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_house_5_color: { label: 'Kleur Huis Popup 5', helper: 'Kleur voor huis popup lijn 5 tekst.' },
          sensor_popup_house_5_font_size: { label: 'Lettergrootte Huis Popup 5 (px)', helper: 'Lettergrootte voor huis popup lijn 5. Standaard 16' },
          sensor_popup_house_6: { label: 'Huis Popup 6', helper: 'Entiteit voor huis popup lijn 6.' },
          sensor_popup_house_6_name: { label: 'Naam Huis Popup 6', helper: 'Optionele aangepaste naam voor huis popup lijn 6. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_house_6_color: { label: 'Kleur Huis Popup 6', helper: 'Kleur voor huis popup lijn 6 tekst.' },
          sensor_popup_house_6_font_size: { label: 'Lettergrootte Huis Popup 6 (px)', helper: 'Lettergrootte voor huis popup lijn 6. Standaard 16' },
          sensor_popup_bat_1: { label: 'Battery Popup 1', helper: 'Entiteit voor battery popup lijn 1.' },
          sensor_popup_bat_1_name: { label: 'Naam Battery Popup 1', helper: 'Optionele aangepaste naam voor battery popup lijn 1. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_bat_1_color: { label: 'Kleur Battery Popup 1', helper: 'Kleur voor battery popup lijn 1 tekst.' },
          sensor_popup_bat_1_font_size: { label: 'Lettergrootte Battery Popup 1 (px)', helper: 'Lettergrootte voor battery popup lijn 1. Standaard 16' },
          sensor_popup_bat_2: { label: 'Battery Popup 2', helper: 'Entiteit voor battery popup lijn 2.' },
          sensor_popup_bat_2_name: { label: 'Naam Battery Popup 2', helper: 'Optionele aangepaste naam voor battery popup lijn 2. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_bat_2_color: { label: 'Kleur Battery Popup 2', helper: 'Kleur voor battery popup lijn 2 tekst.' },
          sensor_popup_bat_2_font_size: { label: 'Lettergrootte Battery Popup 2 (px)', helper: 'Lettergrootte voor battery popup lijn 2. Standaard 16' },
          sensor_popup_bat_3: { label: 'Battery Popup 3', helper: 'Entiteit voor battery popup lijn 3.' },
          sensor_popup_bat_3_name: { label: 'Naam Battery Popup 3', helper: 'Optionele aangepaste naam voor battery popup lijn 3. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_bat_3_color: { label: 'Kleur Battery Popup 3', helper: 'Kleur voor battery popup lijn 3 tekst.' },
          sensor_popup_bat_3_font_size: { label: 'Lettergrootte Battery Popup 3 (px)', helper: 'Lettergrootte voor battery popup lijn 3. Standaard 16' },
          sensor_popup_bat_4: { label: 'Battery Popup 4', helper: 'Entiteit voor battery popup lijn 4.' },
          sensor_popup_bat_4_name: { label: 'Naam Battery Popup 4', helper: 'Optionele aangepaste naam voor battery popup lijn 4. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_bat_4_color: { label: 'Kleur Battery Popup 4', helper: 'Kleur voor battery popup lijn 4 tekst.' },
          sensor_popup_bat_4_font_size: { label: 'Lettergrootte Battery Popup 4 (px)', helper: 'Lettergrootte voor battery popup lijn 4. Standaard 16' },
          sensor_popup_bat_5: { label: 'Battery Popup 5', helper: 'Entiteit voor battery popup lijn 5.' },
          sensor_popup_bat_5_name: { label: 'Naam Battery Popup 5', helper: 'Optionele aangepaste naam voor battery popup lijn 5. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_bat_5_color: { label: 'Kleur Battery Popup 5', helper: 'Kleur voor battery popup lijn 5 tekst.' },
          sensor_popup_bat_5_font_size: { label: 'Lettergrootte Battery Popup 5 (px)', helper: 'Lettergrootte voor battery popup lijn 5. Standaard 16' },
          sensor_popup_bat_6: { label: 'Battery Popup 6', helper: 'Entiteit voor battery popup lijn 6.' },
          sensor_popup_bat_6_name: { label: 'Naam Battery Popup 6', helper: 'Optionele aangepaste naam voor battery popup lijn 6. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_bat_6_color: { label: 'Kleur Battery Popup 6', helper: 'Kleur voor battery popup lijn 6 tekst.' },
          sensor_popup_bat_6_font_size: { label: 'Lettergrootte Battery Popup 6 (px)', helper: 'Lettergrootte voor battery popup lijn 6. Standaard 16' },
          sensor_popup_grid_1: { label: 'Grid Popup 1', helper: 'Entiteit voor grid popup lijn 1.' },
          sensor_popup_grid_1_name: { label: 'Naam Grid Popup 1', helper: 'Optionele aangepaste naam voor grid popup lijn 1. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_grid_1_color: { label: 'Kleur Grid Popup 1', helper: 'Kleur voor grid popup lijn 1 tekst.' },
          sensor_popup_grid_1_font_size: { label: 'Lettergrootte Grid Popup 1 (px)', helper: 'Lettergrootte voor grid popup lijn 1. Standaard 16' },
          sensor_popup_grid_2: { label: 'Grid Popup 2', helper: 'Entiteit voor grid popup lijn 2.' },
          sensor_popup_grid_2_name: { label: 'Naam Grid Popup 2', helper: 'Optionele aangepaste naam voor grid popup lijn 2. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_grid_2_color: { label: 'Kleur Grid Popup 2', helper: 'Kleur voor grid popup lijn 2 tekst.' },
          sensor_popup_grid_2_font_size: { label: 'Lettergrootte Grid Popup 2 (px)', helper: 'Lettergrootte voor grid popup lijn 2. Standaard 16' },
          sensor_popup_grid_3: { label: 'Grid Popup 3', helper: 'Entiteit voor grid popup lijn 3.' },
          sensor_popup_grid_3_name: { label: 'Naam Grid Popup 3', helper: 'Optionele aangepaste naam voor grid popup lijn 3. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_grid_3_color: { label: 'Kleur Grid Popup 3', helper: 'Kleur voor grid popup lijn 3 tekst.' },
          sensor_popup_grid_3_font_size: { label: 'Lettergrootte Grid Popup 3 (px)', helper: 'Lettergrootte voor grid popup lijn 3. Standaard 16' },
          sensor_popup_grid_4: { label: 'Grid Popup 4', helper: 'Entiteit voor grid popup lijn 4.' },
          sensor_popup_grid_4_name: { label: 'Naam Grid Popup 4', helper: 'Optionele aangepaste naam voor grid popup lijn 4. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_grid_4_color: { label: 'Kleur Grid Popup 4', helper: 'Kleur voor grid popup lijn 4 tekst.' },
          sensor_popup_grid_4_font_size: { label: 'Lettergrootte Grid Popup 4 (px)', helper: 'Lettergrootte voor grid popup lijn 4. Standaard 16' },
          sensor_popup_grid_5: { label: 'Grid Popup 5', helper: 'Entiteit voor grid popup lijn 5.' },
          sensor_popup_grid_5_name: { label: 'Naam Grid Popup 5', helper: 'Optionele aangepaste naam voor grid popup lijn 5. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_grid_5_color: { label: 'Kleur Grid Popup 5', helper: 'Kleur voor grid popup lijn 5 tekst.' },
          sensor_popup_grid_5_font_size: { label: 'Lettergrootte Grid Popup 5 (px)', helper: 'Lettergrootte voor grid popup lijn 5. Standaard 16' },
          sensor_popup_grid_6: { label: 'Grid Popup 6', helper: 'Entiteit voor grid popup lijn 6.' },
          sensor_popup_grid_6_name: { label: 'Naam Grid Popup 6', helper: 'Optionele aangepaste naam voor grid popup lijn 6. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_grid_6_color: { label: 'Kleur Grid Popup 6', helper: 'Kleur voor grid popup lijn 6 tekst.' },
          sensor_popup_grid_6_font_size: { label: 'Lettergrootte Grid Popup 6 (px)', helper: 'Lettergrootte voor grid popup lijn 6. Standaard 16' },
          sensor_popup_inverter_1: { label: 'Inverter Popup 1', helper: 'Entiteit voor inverter popup lijn 1.' },
          sensor_popup_inverter_1_name: { label: 'Naam Inverter Popup 1', helper: 'Optionele aangepaste naam voor inverter popup lijn 1. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_inverter_1_color: { label: 'Kleur Inverter Popup 1', helper: 'Kleur voor inverter popup lijn 1 tekst.' },
          sensor_popup_inverter_1_font_size: { label: 'Lettergrootte Inverter Popup 1 (px)', helper: 'Lettergrootte voor inverter popup lijn 1. Standaard 16' },
          sensor_popup_inverter_2: { label: 'Inverter Popup 2', helper: 'Entiteit voor inverter popup lijn 2.' },
          sensor_popup_inverter_2_name: { label: 'Naam Inverter Popup 2', helper: 'Optionele aangepaste naam voor inverter popup lijn 2. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_inverter_2_color: { label: 'Kleur Inverter Popup 2', helper: 'Kleur voor inverter popup lijn 2 tekst.' },
          sensor_popup_inverter_2_font_size: { label: 'Lettergrootte Inverter Popup 2 (px)', helper: 'Lettergrootte voor inverter popup lijn 2. Standaard 16' },
          sensor_popup_inverter_3: { label: 'Inverter Popup 3', helper: 'Entiteit voor inverter popup lijn 3.' },
          sensor_popup_inverter_3_name: { label: 'Naam Inverter Popup 3', helper: 'Optionele aangepaste naam voor inverter popup lijn 3. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_inverter_3_color: { label: 'Kleur Inverter Popup 3', helper: 'Kleur voor inverter popup lijn 3 tekst.' },
          sensor_popup_inverter_3_font_size: { label: 'Lettergrootte Inverter Popup 3 (px)', helper: 'Lettergrootte voor inverter popup lijn 3. Standaard 16' },
          sensor_popup_inverter_4: { label: 'Inverter Popup 4', helper: 'Entiteit voor inverter popup lijn 4.' },
          sensor_popup_inverter_4_name: { label: 'Naam Inverter Popup 4', helper: 'Optionele aangepaste naam voor inverter popup lijn 4. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_inverter_4_color: { label: 'Kleur Inverter Popup 4', helper: 'Kleur voor inverter popup lijn 4 tekst.' },
          sensor_popup_inverter_4_font_size: { label: 'Lettergrootte Inverter Popup 4 (px)', helper: 'Lettergrootte voor inverter popup lijn 4. Standaard 16' },
          sensor_popup_inverter_5: { label: 'Inverter Popup 5', helper: 'Entiteit voor inverter popup lijn 5.' },
          sensor_popup_inverter_5_name: { label: 'Naam Inverter Popup 5', helper: 'Optionele aangepaste naam voor inverter popup lijn 5. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_inverter_5_color: { label: 'Kleur Inverter Popup 5', helper: 'Kleur voor inverter popup lijn 5 tekst.' },
          sensor_popup_inverter_5_font_size: { label: 'Lettergrootte Inverter Popup 5 (px)', helper: 'Lettergrootte voor inverter popup lijn 5. Standaard 16' },
          sensor_popup_inverter_6: { label: 'Inverter Popup 6', helper: 'Entiteit voor inverter popup lijn 6.' },
          sensor_popup_inverter_6_name: { label: 'Naam Inverter Popup 6', helper: 'Optionele aangepaste naam voor inverter popup lijn 6. Laat leeg om entiteit naam te gebruiken.' },
          sensor_popup_inverter_6_color: { label: 'Kleur Inverter Popup 6', helper: 'Kleur voor inverter popup lijn 6 tekst.' },
          sensor_popup_inverter_6_font_size: { label: 'Lettergrootte Inverter Popup 6 (px)', helper: 'Lettergrootte voor inverter popup lijn 6. Standaard 16' },
          dev_soc_bar_x: { label: 'SOC-balk X (px)', helper: 'Horizontale positie. ViewBox 0–800. Path M 330,370 360,360 350,270 320,280 Z → 325.' },
          dev_soc_bar_y: { label: 'SOC-balk Y (px)', helper: 'Verticale positie. ViewBox 0–450.' },
          dev_soc_bar_width: { label: 'SOC-balk Breedte (px)', helper: 'Balkbreedte. Path bbox 30.' },
          dev_soc_bar_height: { label: 'SOC-balk Hoogte (px)', helper: 'Balkhoogte. Path bbox 85.' },
          dev_soc_bar_rotate: { label: 'SOC-balk Rotatie (°)', helper: 'Rotatie 0–360°. -180…180 voor volle cirkel.' },
          dev_soc_bar_skew_x: { label: 'SOC-balk Scheef X (°)', helper: 'Horizontale scheefhoek in graden.' },
          dev_soc_bar_skew_y: { label: 'SOC-balk Scheef Y (°)', helper: 'Verticale scheefhoek in graden.' },
          soc_bar_opacity: { label: 'SOC-balk Dekking', helper: 'Transparantie 0,05–1.' },
          soc_bar_glow: { label: 'SOC-balk Gloed (px)', helper: 'Drop-shadow blur op verlichte segmenten. 0 = uit.' },
          soc_bar_color_on: { label: 'SOC-balk Kleur (aan)', helper: 'Segmentkleur wanneer verlicht door SOC.' },
          soc_bar_color_off: { label: 'SOC-balk Kleur (uit)', helper: 'Segmentkleur wanneer niet verlicht.' },
          dev_grid_box_x: { label: 'Netwerkbox X (px)', helper: 'Box rechtsboven. Import/Export + dagtotalen.' },
          dev_grid_box_y: { label: 'Netwerkbox Y (px)', helper: 'Verticale positie.' },
          dev_grid_box_width: { label: 'Netwerkbox Breedte (px)', helper: '' },
          dev_grid_box_height: { label: 'Netwerkbox Hoogte (px)', helper: '' },
          dev_grid_box_font_size: { label: 'Netwerkbox Lettergrootte (px)', helper: 'Lettergrootte voor tekst. Leeg = auto.' },
          dev_grid_box_text_color: { label: 'Netwerkbox Tekstkleur', helper: 'Kleur voor alle tekst. Leeg = individuele kleuren.' },
          dev_pv_box_x: { label: 'PV-box X (px)', helper: 'Box linksboven. PV Totaal (som) + Dagproductie.' },
          dev_pv_box_y: { label: 'PV-box Y (px)', helper: 'Verticale positie.' },
          dev_pv_box_width: { label: 'PV-box Breedte (px)', helper: '' },
          dev_pv_box_height: { label: 'PV-box Hoogte (px)', helper: '' },
          dev_pv_box_font_size: { label: 'PV-box Lettergrootte (px)', helper: 'Lettergrootte voor tekst. Leeg = auto.' },
          dev_pv_box_text_color: { label: 'PV-box Tekstkleur', helper: 'Kleur voor alle tekst. Leeg = PV-totaalkleur.' },
          overlay_image_pro_1: { label: 'Overlay Afbeelding Pro 1', helper: 'Pad naar overlay afbeelding pro 1 (bijv. /local/community/lumina-energy-card/overlay_pro_1.png).' },
          overlay_image_pro_2: { label: 'Overlay Afbeelding Pro 2', helper: 'Pad naar overlay afbeelding pro 2 (bijv. /local/community/lumina-energy-card/overlay_pro_2.png).' },
          overlay_image_pro_3: { label: 'Overlay Afbeelding Pro 3', helper: 'Pad naar overlay afbeelding pro 3 (bijv. /local/community/lumina-energy-card/overlay_pro_3.png).' },
          overlay_image_pro_4: { label: 'Overlay Afbeelding Pro 4', helper: 'Pad naar overlay afbeelding pro 4 (bijv. /local/community/lumina-energy-card/overlay_pro_4.png).' },
          overlay_image_pro_5: { label: 'Overlay Afbeelding Pro 5', helper: 'Pad naar overlay afbeelding pro 5 (bijv. /local/community/lumina-energy-card/overlay_pro_5.png).' },
        },
        options: {
          languages: [
            { value: 'en', label: 'English' },
            { value: 'it', label: 'Italiano' },
            { value: 'de', label: 'Deutsch' },
            { value: 'fr', label: 'Français' },
            { value: 'nl', label: 'Nederlands' }
          ],
          display_units: [
            { value: 'W', label: 'Watt (W)' },
            { value: 'kW', label: 'Kilowatt (kW)' }
          ],
          animation_styles: [
            { value: 'dashes', label: 'Strepen (standaard)' },
            { value: 'dots', label: 'Stippen' },
            { value: 'arrows', label: 'Pijlen' },
            { value: 'shimmer', label: 'Glinsteren' }
          ]
        },
        view: {
          daily: 'DAGOPBRENGST',
          pv_tot: 'PV TOTAAL',
          car1: 'AUTO 1',
          car2: 'AUTO 2',
          importing: 'IMPORTEREN',
          exporting: 'EXPORTEREN'
        }
      },
    };
  }

  _currentLanguage() {
    const candidate = (this._config && this._config.language) || this._defaults.language || 'en';
    if (candidate && this._strings[candidate]) {
      return candidate;
    }
    return 'en';
  }

  _getLocaleStrings() {
    const lang = this._currentLanguage();
    const base = this._strings.en || {};
    const selected = this._strings[lang] || {};
    // Merge top-level sections, fields, and options so missing entries fall back to English
    const merged = {
      sections: { ...(base.sections || {}), ...(selected.sections || {}) },
      fields: { ...(base.fields || {}), ...(selected.fields || {}) },
      options: { ...(base.options || {}), ...(selected.options || {}) }
    };
    return merged;
  }

  _createOptionDefs(localeStrings) {
    const layoutFields = (type, label) => {
      const prefix = type === 'heatPump' ? 'heatpump' : type;
      return [
        {
          name: `dev_text_${prefix}_x`,
          label: `${label} X`,
          selector: { number: { min: 0, max: 1000, step: 1, mode: 'box' } }
        },
        {
          name: `dev_text_${prefix}_y`,
          label: `${label} Y`,
          selector: { number: { min: 0, max: 1000, step: 1, mode: 'box' } }
        },
        {
          name: `dev_text_${prefix}_rotate`,
          label: `${label} Rotation`,
          selector: { number: { min: -360, max: 360, step: 1, mode: 'box' } }
        }
      ];
    };

    return {
      language: this._getAvailableLanguageOptions(localeStrings),
      display_unit: localeStrings.options.display_units,
      animation_style: localeStrings.options.animation_styles,
      layout_fields: {
        solar: layoutFields('solar', 'Solar'),
        battery: layoutFields('battery', 'Battery'),
        home: layoutFields('home', 'Home'),
        grid: layoutFields('grid', 'Grid'),
        heatPump: layoutFields('heatPump', 'Heat Pump')
      }
    };
  }

  _getAvailableLanguageOptions(localeStrings) {
    const displayLang = this._currentLanguage();
    const keys = this._strings ? Object.keys(this._strings) : [];
    const codes = Array.from(new Set(keys)).filter(k => typeof k === 'string' && k.length === 2);

    const options = codes.map((lang) => {
      let label = null;
      // Fallback to built-in options block if available
      if (localeStrings && localeStrings.options && Array.isArray(localeStrings.options.languages)) {
        label = (localeStrings.options.languages.find((o) => o.value === lang) || {}).label;
      }
      return { value: lang, label: label || lang };
    });
    // Ensure English is always present and first
    const hasEn = options.find(o => o.value === 'en');
    if (!hasEn) options.unshift({ value: 'en', label: 'English' });
    else options.sort((a, b) => (a.value === 'en' ? -1 : (b.value === 'en' ? 1 : a.value.localeCompare(b.value))));
    return options;
  }

  _createSchemaDefs(localeStrings, optionDefs) {
    const entitySelector = { entity: { domain: ['sensor', 'input_number'] } };
    const popupEntitySelector = { entity: {} };
    // Selector for motion sensors - shows ALL entities without domain restrictions
    const motionSensorSelector = { entity: {} };
    const cameraEntitySelector = { entity: { domain: ['camera'] } };
    const fields = localeStrings.fields;
    const define = (entries) => entries.map((entry) => {
      const result = { ...entry };
      if (entry.name && this._defaults[entry.name] !== undefined && result.default === undefined) {
        result.default = this._defaults[entry.name];
      }
      return result;
    });
    
    // Helper function to generate layout fields for text positioning (sliders + skew/scale)
    const createLayoutFields = (type, label) => {
      const prefix = type === 'heatPump' ? 'heatpump' : type;
      return [
        {
          name: `dev_text_${prefix}_x`,
          label: `${label} X (px)`,
          selector: { number: { min: 0, max: 800, step: 1, mode: 'slider', unit_of_measurement: 'px' } }
        },
        {
          name: `dev_text_${prefix}_y`,
          label: `${label} Y (px)`,
          selector: { number: { min: 0, max: 450, step: 1, mode: 'slider', unit_of_measurement: 'px' } }
        },
        {
          name: `dev_text_${prefix}_rotate`,
          label: `${label} Rotation (°)`,
          selector: { number: { min: -360, max: 360, step: 1, mode: 'slider', unit_of_measurement: '°' } }
        },
        {
          name: `dev_text_${prefix}_skewX`,
          label: `${label} Skew X (°)`,
          selector: { number: { min: -90, max: 90, step: 1, mode: 'slider', unit_of_measurement: '°' } }
        },
        {
          name: `dev_text_${prefix}_skewY`,
          label: `${label} Skew Y (°)`,
          selector: { number: { min: -90, max: 90, step: 1, mode: 'slider', unit_of_measurement: '°' } }
        },
        {
          name: `dev_text_${prefix}_scaleX`,
          label: `${label} Scale X (stretch H)`,
          selector: { number: { min: 0.25, max: 3, step: 0.05, mode: 'slider' } }
        },
        {
          name: `dev_text_${prefix}_scaleY`,
          label: `${label} Scale Y (stretch V)`,
          selector: { number: { min: 0.25, max: 3, step: 0.05, mode: 'slider' } }
        }
      ];
    };
    
    // Helper function to generate popup schema fields (eliminates duplication)
    const createPopupSchemaFields = (popupType, maxLines = 6) => {
      const popupFields = [];
      for (let i = 1; i <= maxLines; i++) {
        const fieldKey = `sensor_popup_${popupType}_${i}`;
        const nameKey = `sensor_popup_${popupType}_${i}_name`;
        popupFields.push(
          { 
            name: fieldKey, 
            label: (fields[fieldKey] && fields[fieldKey].label) || '', 
            helper: (fields[fieldKey] && fields[fieldKey].helper) || '', 
            selector: popupEntitySelector 
          },
          { 
            name: nameKey, 
            label: (fields[nameKey] && fields[nameKey].label) || '', 
            helper: (fields[nameKey] && fields[nameKey].helper) || '', 
            selector: { text: {} } 
          }
        );
      }
      return popupFields;
    };
    const configWithDefaults = this._configWithDefaults();
    const displayUnitValue = (configWithDefaults.display_unit || 'kW').toUpperCase();
    const buildThresholdSelector = () => (
      displayUnitValue === 'KW'
        ? { number: { min: 0, max: 100, step: 0.05, unit_of_measurement: 'kW' } }
        : { number: { min: 0, max: 100000, step: 50, unit_of_measurement: 'W' } }
    );
    const pathPresetOptions = [
      { value: 'custom', label: 'Custom Coordinates' },
      { value: 'horizontal_lr', label: 'Horizontal (Left to Right)' },
      { value: 'horizontal_rl', label: 'Horizontal (Right to Left)' },
      { value: 'vertical_tb', label: 'Vertical (Top to Bottom)' },
      { value: 'vertical_bt', label: 'Vertical (Bottom to Top)' },
      { value: 'diagonal_tl_br', label: 'Diagonal (Top-Left to Bottom-Right)' },
      { value: 'diagonal_bl_tr', label: 'Diagonal (Bottom-Left to Top-Right)' },
      { value: 'l_shape_down', label: 'L-Shape (Right then Down)' },
      { value: 'l_shape_up', label: 'L-Shape (Right then Up)' },
      { value: 'solar_to_house', label: 'Solar to House' },
      { value: 'grid_to_house', label: 'Grid to House' },
      { value: 'house_to_grid', label: 'House to Grid' },
      { value: 'battery_charge', label: 'To Battery' },
      { value: 'battery_discharge', label: 'From Battery' }
    ];

    return {
      language: define([
        { name: 'language', label: fields.language.label, helper: fields.language.helper, selector: { select: { options: optionDefs.language } } }
      ]),
      general: define([
        { name: 'card_title', label: fields.card_title.label, helper: fields.card_title.helper, selector: { text: { mode: 'blur' } } },
        { name: 'display_unit', label: fields.display_unit.label, helper: fields.display_unit.helper, selector: { select: { options: optionDefs.display_unit } } },
        { name: 'update_interval', label: fields.update_interval.label, helper: fields.update_interval.helper, selector: { number: { min: 0, max: 60, step: 5, mode: 'slider', unit_of_measurement: 's' } } },
        { name: 'animation_speed_factor', label: fields.animation_speed_factor.label, helper: fields.animation_speed_factor.helper, selector: { number: { min: -3, max: 3, step: 0.25, mode: 'slider', unit_of_measurement: 'x' } } },
        { name: 'enable_text_toggle_button', label: fields.enable_text_toggle_button.label, helper: fields.enable_text_toggle_button.helper, selector: { boolean: {} }, default: true },
        { name: 'text_toggle_button_x', label: (fields.text_toggle_button_x && fields.text_toggle_button_x.label) || 'Text Toggle Button X (px)', helper: (fields.text_toggle_button_x && fields.text_toggle_button_x.helper) || 'Horizontal position of the text toggle button. Left edge distance in pixels.', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } }, default: 30 },
        { name: 'text_toggle_button_y', label: (fields.text_toggle_button_y && fields.text_toggle_button_y.label) || 'Text Toggle Button Y (px)', helper: (fields.text_toggle_button_y && fields.text_toggle_button_y.helper) || 'Vertical position from top in pixels (0-450). Leave empty or set > 450 to position at bottom. Values > 450 will be treated as bottom positioning.', selector: { number: { min: 0, max: 500, step: 1, mode: 'box', unit_of_measurement: 'px' } }, default: null },
        { name: 'text_toggle_button_scale', label: (fields.text_toggle_button_scale && fields.text_toggle_button_scale.label) || 'Text Toggle Button Scale', helper: (fields.text_toggle_button_scale && fields.text_toggle_button_scale.helper) || 'Scale factor for button size (0.5 to 2.0). 1.0 = default size.', selector: { number: { min: 0.5, max: 2.0, step: 0.1, mode: 'slider' } }, default: 1.0 },
        { name: 'text_font_size', label: (fields.text_font_size && fields.text_font_size.label) || 'Text Font Size (px)', helper: (fields.text_font_size && fields.text_font_size.helper) || 'Unified font size for all text elements (Solar, Battery, Grid, Car, Heat Pump, Home). Default: 12px.', selector: { number: { min: 8, max: 32, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 12 },
        
      ]),
      array1: define([
        { name: 'sensor_pv_total', label: fields.sensor_pv_total.label, helper: fields.sensor_pv_total.helper, selector: entitySelector },
        { name: 'sensor_pv1', label: fields.sensor_pv1.label, helper: fields.sensor_pv1.helper, selector: entitySelector },
        { name: 'sensor_pv2', label: fields.sensor_pv2.label, helper: fields.sensor_pv2.helper, selector: entitySelector },
        { name: 'sensor_pv3', label: fields.sensor_pv3.label, helper: fields.sensor_pv3.helper, selector: entitySelector },
        { name: 'sensor_pv4', label: fields.sensor_pv4.label, helper: fields.sensor_pv4.helper, selector: entitySelector },
        { name: 'sensor_pv5', label: fields.sensor_pv5.label, helper: fields.sensor_pv5.helper, selector: entitySelector },
        { name: 'sensor_pv6', label: fields.sensor_pv6.label, helper: fields.sensor_pv6.helper, selector: entitySelector },
        { name: 'sensor_daily', label: fields.sensor_daily.label, helper: fields.sensor_daily.helper, selector: entitySelector },
        { name: 'show_pv_strings', label: fields.show_pv_strings.label, helper: fields.show_pv_strings.helper, selector: { boolean: {} } },
        { name: 'array1_invert_flow', label: (fields.array1_invert_flow && fields.array1_invert_flow.label) || 'Array 1 Invert Flow', helper: (fields.array1_invert_flow && fields.array1_invert_flow.helper) || 'Invert the flow direction for Array 1 (PV1). Useful if the sensor polarity is reversed.', selector: { boolean: {} }, default: false },
        { name: 'pv_text_color', label: (fields.pv_text_color && fields.pv_text_color.label) || 'PV Text Color', helper: (fields.pv_text_color && fields.pv_text_color.helper) || 'Color for PV/solar labels.', selector: { color_picker: {} }, default: '#00f9f9' },
        { name: 'pv_font_size', label: (fields.pv_font_size && fields.pv_font_size.label) || 'PV Font Size (px)', helper: (fields.pv_font_size && fields.pv_font_size.helper) || 'Font size for PV text.', selector: { number: { min: 8, max: 32, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 12 },
      ]),
      array2: define([
        { name: 'sensor_pv_total_secondary', label: fields.sensor_pv_total_secondary.label, helper: fields.sensor_pv_total_secondary.helper, selector: entitySelector },
        { name: 'sensor_pv_array2_1', label: fields.sensor_pv_array2_1.label, helper: fields.sensor_pv_array2_1.helper, selector: entitySelector },
        { name: 'sensor_pv_array2_2', label: fields.sensor_pv_array2_2.label, helper: fields.sensor_pv_array2_2.helper, selector: entitySelector },
        { name: 'sensor_pv_array2_3', label: fields.sensor_pv_array2_3.label, helper: fields.sensor_pv_array2_3.helper, selector: entitySelector },
        { name: 'sensor_pv_array2_4', label: fields.sensor_pv_array2_4.label, helper: fields.sensor_pv_array2_4.helper, selector: entitySelector },
        { name: 'sensor_pv_array2_5', label: fields.sensor_pv_array2_5.label, helper: fields.sensor_pv_array2_5.helper, selector: entitySelector },
        { name: 'sensor_pv_array2_6', label: fields.sensor_pv_array2_6.label, helper: fields.sensor_pv_array2_6.helper, selector: entitySelector },
        { name: 'sensor_daily_array2', label: fields.sensor_daily_array2.label, helper: fields.sensor_daily_array2.helper, selector: entitySelector },
        { name: 'pv_secondary_text_color', label: (fields.pv_secondary_text_color && fields.pv_secondary_text_color.label) || 'Array 2 Text Color', helper: (fields.pv_secondary_text_color && fields.pv_secondary_text_color.helper) || 'Color for Array 2 text labels.', selector: { color_picker: {} }, default: '#00f9f9' },
        { name: 'pv_secondary_font_size', label: (fields.pv_secondary_font_size && fields.pv_secondary_font_size.label) || 'Array 2 Font Size (px)', helper: (fields.pv_secondary_font_size && fields.pv_secondary_font_size.helper) || 'Font size for Array 2 text.', selector: { number: { min: 8, max: 32, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 12 },
      ]),
      battery: define([
        { name: 'sensor_bat1_soc', label: fields.sensor_bat1_soc.label, helper: fields.sensor_bat1_soc.helper, selector: entitySelector },
        { name: 'sensor_bat1_power', label: fields.sensor_bat1_power.label, helper: fields.sensor_bat1_power.helper, selector: entitySelector },
        { name: 'sensor_bat2_soc', label: fields.sensor_bat2_soc.label, helper: fields.sensor_bat2_soc.helper, selector: entitySelector },
        { name: 'sensor_bat2_power', label: fields.sensor_bat2_power.label, helper: fields.sensor_bat2_power.helper, selector: entitySelector },
        { name: 'sensor_bat3_soc', label: fields.sensor_bat3_soc.label, helper: fields.sensor_bat3_soc.helper, selector: entitySelector },
        { name: 'sensor_bat3_power', label: fields.sensor_bat3_power.label, helper: fields.sensor_bat3_power.helper, selector: entitySelector },
        { name: 'sensor_bat4_soc', label: fields.sensor_bat4_soc.label, helper: fields.sensor_bat4_soc.helper, selector: entitySelector },
        { name: 'sensor_bat4_power', label: fields.sensor_bat4_power.label, helper: fields.sensor_bat4_power.helper, selector: entitySelector },
        { name: 'battery_power_mode', label: (fields.battery_power_mode && fields.battery_power_mode.label) || 'Battery Power Mode', helper: (fields.battery_power_mode && fields.battery_power_mode.helper) || 'Flow: single signed sensor (+ = charge, - = discharge). Charge+Discharge: separate sensors.', selector: { select: { options: [['flow', 'Flow (signed)'], ['charge_discharge', 'Charge + Discharge']] } }, default: 'flow' },
        { name: 'sensor_battery_flow', label: (fields.sensor_battery_flow && fields.sensor_battery_flow.label) || 'Battery Flow (signed)', helper: (fields.sensor_battery_flow && fields.sensor_battery_flow.helper) || 'Optional. Single sensor: + = charge, - = discharge. Used when mode is Flow.', selector: entitySelector },
        { name: 'sensor_battery_charge', label: (fields.sensor_battery_charge && fields.sensor_battery_charge.label) || 'Battery Charge', helper: (fields.sensor_battery_charge && fields.sensor_battery_charge.helper) || 'Power when charging; flow to battery. Mode Charge+Discharge.', selector: entitySelector },
        { name: 'sensor_battery_discharge', label: (fields.sensor_battery_discharge && fields.sensor_battery_discharge.label) || 'Battery Discharge', helper: (fields.sensor_battery_discharge && fields.sensor_battery_discharge.helper) || 'Power when discharging; flow to inverter. Mode Charge+Discharge.', selector: entitySelector },
        { name: 'invert_battery', label: fields.invert_battery.label, helper: fields.invert_battery.helper, selector: { boolean: {} } },
        { name: 'battery_text_color', label: (fields.battery_text_color && fields.battery_text_color.label) || 'Battery Text Color', helper: (fields.battery_text_color && fields.battery_text_color.helper) || 'Color for SOC and power.', selector: { color_picker: {} }, default: '#00f9f9' },
        { name: 'battery_font_size', label: (fields.battery_font_size && fields.battery_font_size.label) || 'Battery Font Size (px)', helper: (fields.battery_font_size && fields.battery_font_size.helper) || 'Font size for battery text.', selector: { number: { min: 8, max: 32, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 12 },
      ]),
      grid: define([
        { name: 'sensor_grid_power', label: fields.sensor_grid_power.label, helper: fields.sensor_grid_power.helper, selector: entitySelector },
        { name: 'sensor_grid_import', label: fields.sensor_grid_import.label, helper: fields.sensor_grid_import.helper, selector: entitySelector },
        { name: 'sensor_grid_export', label: fields.sensor_grid_export.label, helper: fields.sensor_grid_export.helper, selector: entitySelector },
        { name: 'sensor_grid_import_daily', label: fields.sensor_grid_import_daily.label, helper: fields.sensor_grid_import_daily.helper, selector: entitySelector },
        { name: 'sensor_grid_export_daily', label: fields.sensor_grid_export_daily.label, helper: fields.sensor_grid_export_daily.helper, selector: entitySelector },
        { name: 'invert_grid', label: fields.invert_grid.label, helper: fields.invert_grid.helper, selector: { boolean: {} } },
        { name: 'enable_echo_alive', label: (fields.enable_echo_alive && fields.enable_echo_alive.label) || 'Enable Echo Alive', helper: (fields.enable_echo_alive && fields.enable_echo_alive.helper) || 'Enables an invisible iframe to keep the Silk browser open on Echo Show.', selector: { boolean: {} }, default: false },
        { name: 'sensor_home_load', label: fields.sensor_home_load.label, helper: fields.sensor_home_load.helper, selector: entitySelector },
        { name: 'sensor_home_load_secondary', label: fields.sensor_home_load_secondary.label, helper: fields.sensor_home_load_secondary.helper, selector: entitySelector },
        { name: 'grid_text_color', label: (fields.grid_text_color && fields.grid_text_color.label) || 'Grid Text Color', helper: (fields.grid_text_color && fields.grid_text_color.helper) || 'Color for grid meter.', selector: { color_picker: {} }, default: '#00f9f9' },
        { name: 'grid_font_size', label: (fields.grid_font_size && fields.grid_font_size.label) || 'Grid Font Size (px)', helper: (fields.grid_font_size && fields.grid_font_size.helper) || 'Font size for grid text.', selector: { number: { min: 8, max: 32, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 15 },
      ]),
      car: define([
        { name: 'show_car_soc', label: fields.show_car_soc.label, helper: fields.show_car_soc.helper, selector: { boolean: {} } },
        { name: 'show_car2', label: fields.show_car2.label, helper: fields.show_car2.helper, selector: { boolean: {} } },
        { name: 'car1_bidirectional', label: fields.car1_bidirectional.label, helper: fields.car1_bidirectional.helper, selector: { boolean: {} }, default: false },
        { name: 'car2_bidirectional', label: fields.car2_bidirectional.label, helper: fields.car2_bidirectional.helper, selector: { boolean: {} }, default: false },
        { name: 'car1_invert_flow', label: fields.car1_invert_flow.label, helper: fields.car1_invert_flow.helper, selector: { boolean: {} }, default: false },
        { name: 'car2_invert_flow', label: fields.car2_invert_flow.label, helper: fields.car2_invert_flow.helper, selector: { boolean: {} }, default: false },
        { name: 'sensor_car_power', label: fields.sensor_car_power.label, helper: fields.sensor_car_power.helper, selector: entitySelector },
        { name: 'sensor_car_soc', label: fields.sensor_car_soc.label, helper: fields.sensor_car_soc.helper, selector: entitySelector },
        { name: 'sensor_car2_power', label: fields.sensor_car2_power.label, helper: fields.sensor_car2_power.helper, selector: entitySelector },
        { name: 'sensor_car2_soc', label: fields.sensor_car2_soc.label, helper: fields.sensor_car2_soc.helper, selector: entitySelector },
        { name: 'car1_label', label: fields.car1_label.label, helper: fields.car1_label.helper, selector: { text: { mode: 'blur' } } },
        { name: 'car2_label', label: fields.car2_label.label, helper: fields.car2_label.helper, selector: { text: { mode: 'blur' } } },
        { name: 'car_text_color', label: (fields.car_text_color && fields.car_text_color.label) || 'Car Text Color', helper: (fields.car_text_color && fields.car_text_color.helper) || 'Color for car labels, power, %.', selector: { color_picker: {} }, default: '#00f9f9' },
        { name: 'car_font_size', label: (fields.car_font_size && fields.car_font_size.label) || 'Car Font Size (px)', helper: (fields.car_font_size && fields.car_font_size.helper) || 'Font size for car text.', selector: { number: { min: 8, max: 28, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 12 },
      ]),
      heatPump: define([
        { name: 'sensor_heat_pump_consumption', label: fields.sensor_heat_pump_consumption.label, helper: fields.sensor_heat_pump_consumption.helper, selector: entitySelector },
        { name: 'heat_pump_text_color', label: (fields.heat_pump_text_color && fields.heat_pump_text_color.label) || 'Heat Pump Text Color', helper: (fields.heat_pump_text_color && fields.heat_pump_text_color.helper) || 'Color for heat pump text.', selector: { color_picker: {} }, default: '#00f9f9' },
        { name: 'heat_pump_font_size', label: (fields.heat_pump_font_size && fields.heat_pump_font_size.label) || 'Heat Pump Font Size (px)', helper: (fields.heat_pump_font_size && fields.heat_pump_font_size.helper) || 'Font size for heat pump text.', selector: { number: { min: 8, max: 32, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 12 },
      ]),
      entities: define([
        
      ]),
      house_management: define([
        ...Array.from({ length: 6 }, (_, i) => ({
          name: `house_camera_${i + 1}`,
          label: (fields[`house_camera_${i + 1}`] && fields[`house_camera_${i + 1}`].label) || `Camera ${i + 1}`,
          helper: (fields[`house_camera_${i + 1}`] && fields[`house_camera_${i + 1}`].helper) || (i === 0 ? 'Camera entity for streaming. Up to 6 cameras. Click camera icon to open popup.' : ''),
          selector: cameraEntitySelector,
          default: ''
        })),
        ...Array.from({ length: 6 }, (_, i) => ({
          name: `house_lights_${i + 1}`,
          label: (fields[`house_lights_${i + 1}`] && fields[`house_lights_${i + 1}`].label) || `Lights ${i + 1}`,
          helper: (fields[`house_lights_${i + 1}`] && fields[`house_lights_${i + 1}`].helper) || (i === 0 ? 'Entity for lights (light, switch). Up to 6.' : ''),
          selector: popupEntitySelector,
          default: ''
        })),
        ...Array.from({ length: 6 }, (_, i) => ({
          name: `house_temperature_${i + 1}`,
          label: (fields[`house_temperature_${i + 1}`] && fields[`house_temperature_${i + 1}`].label) || `Temperature ${i + 1}`,
          helper: (fields[`house_temperature_${i + 1}`] && fields[`house_temperature_${i + 1}`].helper) || (i === 0 ? 'Temperature entity. Up to 6.' : ''),
          selector: popupEntitySelector,
          default: ''
        })),
        ...Array.from({ length: 6 }, (_, i) => ({
          name: `house_security_${i + 1}`,
          label: (fields[`house_security_${i + 1}`] && fields[`house_security_${i + 1}`].label) || `Security ${i + 1}`,
          helper: (fields[`house_security_${i + 1}`] && fields[`house_security_${i + 1}`].helper) || (i === 0 ? 'Security / alarm entity. Up to 6.' : ''),
          selector: popupEntitySelector,
          default: ''
        })),
        ...Array.from({ length: 6 }, (_, i) => ({
          name: `house_humidity_${i + 1}`,
          label: (fields[`house_humidity_${i + 1}`] && fields[`house_humidity_${i + 1}`].label) || `Humidity ${i + 1}`,
          helper: (fields[`house_humidity_${i + 1}`] && fields[`house_humidity_${i + 1}`].helper) || (i === 0 ? 'Humidity entity. Up to 6.' : ''),
          selector: popupEntitySelector,
          default: ''
        }))
      ]),
      colors: define([
        { name: 'pv_tot_color', label: fields.pv_tot_color.label, helper: fields.pv_tot_color.helper, selector: { color_picker: {} }, default: '#00FFFF' },
        { name: 'pv_primary_color', label: fields.pv_primary_color.label, helper: fields.pv_primary_color.helper, selector: { color_picker: {} } },
        { name: 'pv_secondary_color', label: fields.pv_secondary_color.label, helper: fields.pv_secondary_color.helper, selector: { color_picker: {} } },
        { name: 'pv_string1_color', label: fields.pv_string1_color.label, helper: fields.pv_string1_color.helper, selector: { color_picker: {} } },
        { name: 'pv_string2_color', label: fields.pv_string2_color.label, helper: fields.pv_string2_color.helper, selector: { color_picker: {} } },
        { name: 'pv_string3_color', label: fields.pv_string3_color.label, helper: fields.pv_string3_color.helper, selector: { color_picker: {} } },
        { name: 'pv_string4_color', label: fields.pv_string4_color.label, helper: fields.pv_string4_color.helper, selector: { color_picker: {} } },
        { name: 'pv_string5_color', label: fields.pv_string5_color.label, helper: fields.pv_string5_color.helper, selector: { color_picker: {} } },
        { name: 'pv_string6_color', label: fields.pv_string6_color.label, helper: fields.pv_string6_color.helper, selector: { color_picker: {} } },
        { name: 'load_flow_color', label: fields.load_flow_color.label, helper: fields.load_flow_color.helper, selector: { color_picker: {} } },
        { name: 'load_text_color', label: fields.load_text_color.label, helper: fields.load_text_color.helper, selector: { color_picker: {} }, default: '#00f9f9' },
        { name: 'inv1_color', label: fields.inv1_color.label, helper: fields.inv1_color.helper, selector: { color_picker: {} }, default: '#0080ff' },
        { name: 'inv2_color', label: fields.inv2_color.label, helper: fields.inv2_color.helper, selector: { color_picker: {} }, default: '#80ffff' },
        { name: 'load_threshold_warning', label: fields.load_threshold_warning.label, helper: fields.load_threshold_warning.helper, selector: buildThresholdSelector(), default: null },
        { name: 'load_warning_color', label: fields.load_warning_color.label, helper: fields.load_warning_color.helper, selector: { color_picker: {} } },
        { name: 'load_threshold_critical', label: fields.load_threshold_critical.label, helper: fields.load_threshold_critical.helper, selector: buildThresholdSelector(), default: null },
        { name: 'load_critical_color', label: fields.load_critical_color.label, helper: fields.load_critical_color.helper, selector: { color_picker: {} } },
        { name: 'battery_soc_color', label: fields.battery_soc_color.label, helper: fields.battery_soc_color.helper, selector: { color_picker: {} } },
        { name: 'battery_charge_color', label: fields.battery_charge_color.label, helper: fields.battery_charge_color.helper, selector: { color_picker: {} } },
        { name: 'battery_discharge_color', label: fields.battery_discharge_color.label, helper: fields.battery_discharge_color.helper, selector: { color_picker: {} } },
        { name: 'grid_import_color', label: fields.grid_import_color.label, helper: fields.grid_import_color.helper, selector: { color_picker: {} } },
        { name: 'grid_export_color', label: fields.grid_export_color.label, helper: fields.grid_export_color.helper, selector: { color_picker: {} } },
        { name: 'car_flow_color', label: fields.car_flow_color.label, helper: fields.car_flow_color.helper, selector: { color_picker: {} } },
        { name: 'grid_activity_threshold', label: fields.grid_activity_threshold.label, helper: fields.grid_activity_threshold.helper, selector: { number: { min: 0, max: 100000, step: 10 } }, default: DEFAULT_GRID_ACTIVITY_THRESHOLD },
        { name: 'grid_threshold_warning', label: fields.grid_threshold_warning.label, helper: fields.grid_threshold_warning.helper, selector: buildThresholdSelector(), default: null },
        { name: 'grid_warning_color', label: fields.grid_warning_color.label, helper: fields.grid_warning_color.helper, selector: { color_picker: {} } },
        { name: 'grid_threshold_critical', label: fields.grid_threshold_critical.label, helper: fields.grid_threshold_critical.helper, selector: buildThresholdSelector(), default: null },
        { name: 'grid_critical_color', label: fields.grid_critical_color.label, helper: fields.grid_critical_color.helper, selector: { color_picker: {} } },
        { name: 'car_pct_color', label: fields.car_pct_color.label, helper: fields.car_pct_color.helper, selector: { color_picker: {} }, default: '#00FFFF' }
        ,{ name: 'car2_pct_color', label: fields.car2_pct_color.label, helper: fields.car2_pct_color.helper, selector: { color_picker: {} }, default: '#00FFFF' }
        ,{ name: 'car1_name_color', label: fields.car1_name_color.label, helper: fields.car1_name_color.helper, selector: { color_picker: {} }, default: '#00f9f9' }
        ,{ name: 'car2_name_color', label: fields.car2_name_color.label, helper: fields.car2_name_color.helper, selector: { color_picker: {} }, default: '#00f9f9' }
        ,{ name: 'car1_color', label: fields.car1_color.label, helper: fields.car1_color.helper, selector: { color_picker: {} }, default: '#00f9f9' }
        ,{ name: 'car2_color', label: fields.car2_color.label, helper: fields.car2_color.helper, selector: { color_picker: {} }, default: '#00f9f9' }
        ,{ name: 'heat_pump_flow_color', label: fields.heat_pump_flow_color.label, helper: fields.heat_pump_flow_color.helper, selector: { color_picker: {} }, default: '#FFA500' }
        ,{ name: 'heat_pump_text_color', label: fields.heat_pump_text_color.label, helper: fields.heat_pump_text_color.helper, selector: { color_picker: {} }, default: '#00f9f9' }
        ,{ name: 'sensor_popup_pv_1_color', label: (fields.sensor_popup_pv_1_color && fields.sensor_popup_pv_1_color.label) || '', helper: (fields.sensor_popup_pv_1_color && fields.sensor_popup_pv_1_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_pv_2_color', label: (fields.sensor_popup_pv_2_color && fields.sensor_popup_pv_2_color.label) || '', helper: (fields.sensor_popup_pv_2_color && fields.sensor_popup_pv_2_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_pv_3_color', label: (fields.sensor_popup_pv_3_color && fields.sensor_popup_pv_3_color.label) || '', helper: (fields.sensor_popup_pv_3_color && fields.sensor_popup_pv_3_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_pv_4_color', label: (fields.sensor_popup_pv_4_color && fields.sensor_popup_pv_4_color.label) || '', helper: (fields.sensor_popup_pv_4_color && fields.sensor_popup_pv_4_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_pv_5_color', label: (fields.sensor_popup_pv_5_color && fields.sensor_popup_pv_5_color.label) || '', helper: (fields.sensor_popup_pv_5_color && fields.sensor_popup_pv_5_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_pv_6_color', label: (fields.sensor_popup_pv_6_color && fields.sensor_popup_pv_6_color.label) || '', helper: (fields.sensor_popup_pv_6_color && fields.sensor_popup_pv_6_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_house_1_color', label: (fields.sensor_popup_house_1_color && fields.sensor_popup_house_1_color.label) || '', helper: (fields.sensor_popup_house_1_color && fields.sensor_popup_house_1_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_house_2_color', label: (fields.sensor_popup_house_2_color && fields.sensor_popup_house_2_color.label) || '', helper: (fields.sensor_popup_house_2_color && fields.sensor_popup_house_2_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_house_3_color', label: (fields.sensor_popup_house_3_color && fields.sensor_popup_house_3_color.label) || '', helper: (fields.sensor_popup_house_3_color && fields.sensor_popup_house_3_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_house_4_color', label: (fields.sensor_popup_house_4_color && fields.sensor_popup_house_4_color.label) || '', helper: (fields.sensor_popup_house_4_color && fields.sensor_popup_house_4_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_house_5_color', label: (fields.sensor_popup_house_5_color && fields.sensor_popup_house_5_color.label) || '', helper: (fields.sensor_popup_house_5_color && fields.sensor_popup_house_5_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_house_6_color', label: (fields.sensor_popup_house_6_color && fields.sensor_popup_house_6_color.label) || '', helper: (fields.sensor_popup_house_6_color && fields.sensor_popup_house_6_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_bat_1_color', label: (fields.sensor_popup_bat_1_color && fields.sensor_popup_bat_1_color.label) || '', helper: (fields.sensor_popup_bat_1_color && fields.sensor_popup_bat_1_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_bat_2_color', label: (fields.sensor_popup_bat_2_color && fields.sensor_popup_bat_2_color.label) || '', helper: (fields.sensor_popup_bat_2_color && fields.sensor_popup_bat_2_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_bat_3_color', label: (fields.sensor_popup_bat_3_color && fields.sensor_popup_bat_3_color.label) || '', helper: (fields.sensor_popup_bat_3_color && fields.sensor_popup_bat_3_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_bat_4_color', label: (fields.sensor_popup_bat_4_color && fields.sensor_popup_bat_4_color.label) || '', helper: (fields.sensor_popup_bat_4_color && fields.sensor_popup_bat_4_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_bat_5_color', label: (fields.sensor_popup_bat_5_color && fields.sensor_popup_bat_5_color.label) || '', helper: (fields.sensor_popup_bat_5_color && fields.sensor_popup_bat_5_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_bat_6_color', label: (fields.sensor_popup_bat_6_color && fields.sensor_popup_bat_6_color.label) || '', helper: (fields.sensor_popup_bat_6_color && fields.sensor_popup_bat_6_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_grid_1_color', label: (fields.sensor_popup_grid_1_color && fields.sensor_popup_grid_1_color.label) || '', helper: (fields.sensor_popup_grid_1_color && fields.sensor_popup_grid_1_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_grid_2_color', label: (fields.sensor_popup_grid_2_color && fields.sensor_popup_grid_2_color.label) || '', helper: (fields.sensor_popup_grid_2_color && fields.sensor_popup_grid_2_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_grid_3_color', label: (fields.sensor_popup_grid_3_color && fields.sensor_popup_grid_3_color.label) || '', helper: (fields.sensor_popup_grid_3_color && fields.sensor_popup_grid_3_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_grid_4_color', label: (fields.sensor_popup_grid_4_color && fields.sensor_popup_grid_4_color.label) || '', helper: (fields.sensor_popup_grid_4_color && fields.sensor_popup_grid_4_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_grid_5_color', label: (fields.sensor_popup_grid_5_color && fields.sensor_popup_grid_5_color.label) || '', helper: (fields.sensor_popup_grid_5_color && fields.sensor_popup_grid_5_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_grid_6_color', label: (fields.sensor_popup_grid_6_color && fields.sensor_popup_grid_6_color.label) || '', helper: (fields.sensor_popup_grid_6_color && fields.sensor_popup_grid_6_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_inverter_1_color', label: (fields.sensor_popup_inverter_1_color && fields.sensor_popup_inverter_1_color.label) || '', helper: (fields.sensor_popup_inverter_1_color && fields.sensor_popup_inverter_1_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_inverter_2_color', label: (fields.sensor_popup_inverter_2_color && fields.sensor_popup_inverter_2_color.label) || '', helper: (fields.sensor_popup_inverter_2_color && fields.sensor_popup_inverter_2_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_inverter_3_color', label: (fields.sensor_popup_inverter_3_color && fields.sensor_popup_inverter_3_color.label) || '', helper: (fields.sensor_popup_inverter_3_color && fields.sensor_popup_inverter_3_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_inverter_4_color', label: (fields.sensor_popup_inverter_4_color && fields.sensor_popup_inverter_4_color.label) || '', helper: (fields.sensor_popup_inverter_4_color && fields.sensor_popup_inverter_4_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_inverter_5_color', label: (fields.sensor_popup_inverter_5_color && fields.sensor_popup_inverter_5_color.label) || '', helper: (fields.sensor_popup_inverter_5_color && fields.sensor_popup_inverter_5_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
        ,{ name: 'sensor_popup_inverter_6_color', label: (fields.sensor_popup_inverter_6_color && fields.sensor_popup_inverter_6_color.label) || '', helper: (fields.sensor_popup_inverter_6_color && fields.sensor_popup_inverter_6_color.helper) || '', selector: { color_picker: {} }, default: '#80ffff' }
      ]),
      flow_colors: define([
        { name: 'pv_primary_color', label: fields.pv_primary_color.label, helper: fields.pv_primary_color.helper, selector: { color_picker: {} } },
        { name: 'pv_secondary_color', label: fields.pv_secondary_color.label, helper: fields.pv_secondary_color.helper, selector: { color_picker: {} } },
        { name: 'battery_charge_color', label: fields.battery_charge_color.label, helper: fields.battery_charge_color.helper, selector: { color_picker: {} } },
        { name: 'battery_discharge_color', label: fields.battery_discharge_color.label, helper: fields.battery_discharge_color.helper, selector: { color_picker: {} } },
        { name: 'load_flow_color', label: fields.load_flow_color.label, helper: fields.load_flow_color.helper, selector: { color_picker: {} } },
        { name: 'grid_import_color', label: fields.grid_import_color.label, helper: fields.grid_import_color.helper, selector: { color_picker: {} } },
        { name: 'grid_export_color', label: fields.grid_export_color.label, helper: fields.grid_export_color.helper, selector: { color_picker: {} } },
        { name: 'car_flow_color', label: fields.car_flow_color.label, helper: fields.car_flow_color.helper, selector: { color_picker: {} } },
        { name: 'heat_pump_flow_color', label: fields.heat_pump_flow_color.label, helper: fields.heat_pump_flow_color.helper, selector: { color_picker: {} } }
      ]),
      animation_styles: define([
        { name: 'animation_style', label: fields.animation_style.label, helper: fields.animation_style.helper, selector: { select: { options: optionDefs.animation_style } }, default: 'shimmer' }
      ]),
      flow_path_custom: define([
        { name: 'pv1_flow_path', label: (fields.pv1_flow_path && fields.pv1_flow_path.label) || 'PV1 Flow Path (SVG)', helper: (fields.pv1_flow_path && fields.pv1_flow_path.helper) || `Custom SVG path string for PV1 flow. Leave empty to use default. Default: ${FLOW_PATHS.pv1}`, selector: { text: { multiline: true, placeholder: FLOW_PATHS.pv1 } }, default: FLOW_PATHS.pv1 },
        { name: 'pv2_flow_path', label: (fields.pv2_flow_path && fields.pv2_flow_path.label) || 'PV2 Flow Path (SVG)', helper: (fields.pv2_flow_path && fields.pv2_flow_path.helper) || `Custom SVG path string for PV2 flow. Leave empty to use default. Default: ${FLOW_PATHS.pv2}`, selector: { text: { multiline: true, placeholder: FLOW_PATHS.pv2 } }, default: FLOW_PATHS.pv2 },
        { name: 'bat_flow_path', label: (fields.bat_flow_path && fields.bat_flow_path.label) || 'Battery Flow Path (SVG)', helper: (fields.bat_flow_path && fields.bat_flow_path.helper) || `Custom SVG path string for battery flow. Leave empty to use default. Default: ${FLOW_PATHS.bat}`, selector: { text: { multiline: true, placeholder: FLOW_PATHS.bat } }, default: FLOW_PATHS.bat },
        { name: 'load_flow_path', label: (fields.load_flow_path && fields.load_flow_path.label) || 'Load Flow Path (SVG)', helper: (fields.load_flow_path && fields.load_flow_path.helper) || `Custom SVG path string for load flow. Leave empty to use default. Default: ${FLOW_PATHS.load}`, selector: { text: { multiline: true, placeholder: FLOW_PATHS.load } }, default: FLOW_PATHS.load },
        { name: 'grid_flow_path', label: (fields.grid_flow_path && fields.grid_flow_path.label) || 'Grid Flow Path (SVG)', helper: (fields.grid_flow_path && fields.grid_flow_path.helper) || `Custom SVG path string for grid flow. Leave empty to use default. Default: ${FLOW_PATHS.grid}`, selector: { text: { multiline: true, placeholder: FLOW_PATHS.grid } }, default: FLOW_PATHS.grid },
        { name: 'grid_house_flow_path', label: (fields.grid_house_flow_path && fields.grid_house_flow_path.label) || 'Grid-House Flow Path (SVG)', helper: (fields.grid_house_flow_path && fields.grid_house_flow_path.helper) || `Custom SVG path string for grid-to-house flow. Leave empty to use default. Default: ${FLOW_PATHS.grid_house}`, selector: { text: { multiline: true, placeholder: FLOW_PATHS.grid_house } }, default: FLOW_PATHS.grid_house },
        { name: 'car1_flow_path', label: (fields.car1_flow_path && fields.car1_flow_path.label) || 'Car1 Flow Path (SVG)', helper: (fields.car1_flow_path && fields.car1_flow_path.helper) || `Custom SVG path string for Car1 flow. Leave empty to use default. Default: ${FLOW_PATHS.car1}`, selector: { text: { multiline: true, placeholder: FLOW_PATHS.car1 } }, default: FLOW_PATHS.car1 },
        { name: 'car2_flow_path', label: (fields.car2_flow_path && fields.car2_flow_path.label) || 'Car2 Flow Path (SVG)', helper: (fields.car2_flow_path && fields.car2_flow_path.helper) || `Custom SVG path string for Car2 flow. Leave empty to use default. Default: ${FLOW_PATHS.car2}`, selector: { text: { multiline: true, placeholder: FLOW_PATHS.car2 } }, default: FLOW_PATHS.car2 },
        { name: 'heat_pump_flow_path', label: (fields.heat_pump_flow_path && fields.heat_pump_flow_path.label) || 'Heat Pump Flow Path (SVG)', helper: (fields.heat_pump_flow_path && fields.heat_pump_flow_path.helper) || `Custom SVG path string for heat pump flow. Leave empty to use default. Default: ${FLOW_PATHS.heatPump}`, selector: { text: { multiline: true, placeholder: FLOW_PATHS.heatPump } }, default: FLOW_PATHS.heatPump },
        { name: 'linea_box_1_path', label: 'Linea Box 1 (SVG)', helper: 'Linea statica sempre visibile (1px, #00f9f9). Path SVG per la prima linea box.', selector: { text: { multiline: true, placeholder: 'M 664,130 730,95 V 82' } }, default: 'M 664,130 730,95 V 82' },
        { name: 'linea_box_2_path', label: 'Linea Box 2 (SVG)', helper: 'Linea statica sempre visibile (1px, #00f9f9). Path SVG per la seconda linea box.', selector: { text: { multiline: true, placeholder: 'M 17,200 8.9,190 9.2,83 89,76' } }, default: 'M 17,200 8.9,190 9.2,83 89,76' },
      ]),
      lumina_pro: define([
        { name: 'custom_flow_1_enabled', label: (fields.custom_flow_1_enabled && fields.custom_flow_1_enabled.label) || 'Custom Flow 1: Enabled', helper: (fields.custom_flow_1_enabled && fields.custom_flow_1_enabled.helper) || 'Enable custom flow 1.', selector: { boolean: {} } },
        { name: 'custom_flow_1_sensor', label: (fields.custom_flow_1_sensor && fields.custom_flow_1_sensor.label) || 'Custom Flow 1: Sensor', helper: (fields.custom_flow_1_sensor && fields.custom_flow_1_sensor.helper) || 'Sensor entity that controls this flow (power sensor). Flow direction is based on sensor value sign.', selector: entitySelector },
        { name: 'custom_flow_1_path_preset', label: 'Custom Flow 1: Path Type', helper: 'Choose a preset path shape or Custom to use Start/End coordinates below.', selector: { select: { options: pathPresetOptions } }, default: 'custom' },
        { name: 'custom_flow_1_start_x', label: 'Flow 1: Start X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_1_start_y', label: 'Flow 1: Start Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_1_end_x', label: 'Flow 1: End X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_1_end_y', label: 'Flow 1: End Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_1_path', label: 'Flow 1: SVG Path (Advanced)', helper: 'Manual SVG path (overrides preset if filled).', selector: { text: { multiline: true } } },
        { name: 'custom_flow_1_color', label: (fields.custom_flow_1_color && fields.custom_flow_1_color.label) || 'Custom Flow 1: Color', helper: (fields.custom_flow_1_color && fields.custom_flow_1_color.helper) || 'Color of the flow.', selector: { color_picker: {} } },
        { name: 'custom_flow_1_threshold', label: (fields.custom_flow_1_threshold && fields.custom_flow_1_threshold.label) || 'Custom Flow 1: Threshold (W)', helper: (fields.custom_flow_1_threshold && fields.custom_flow_1_threshold.helper) || 'Minimum power value (in watts) to activate the flow.', selector: { number: { min: 0, max: 10000, step: 10, mode: 'box', unit_of_measurement: 'W' } } },
        { name: 'custom_flow_1_direction', label: (fields.custom_flow_1_direction && fields.custom_flow_1_direction.label) || 'Custom Flow 1: Direction', helper: (fields.custom_flow_1_direction && fields.custom_flow_1_direction.helper) || 'Flow direction: forward (always positive), reverse (always negative), or auto (based on sensor value sign).', selector: { select: { options: [['forward', 'Forward'], ['reverse', 'Reverse'], ['auto', 'Auto']] } } },
        { name: 'custom_flow_1_offset_x', label: (fields.custom_flow_1_offset_x && fields.custom_flow_1_offset_x.label) || 'Custom Flow 1: Offset X (px)', helper: (fields.custom_flow_1_offset_x && fields.custom_flow_1_offset_x.helper) || 'Horizontal offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_1_offset_y', label: (fields.custom_flow_1_offset_y && fields.custom_flow_1_offset_y.label) || 'Custom Flow 1: Offset Y (px)', helper: (fields.custom_flow_1_offset_y && fields.custom_flow_1_offset_y.helper) || 'Vertical offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_2_enabled', label: (fields.custom_flow_2_enabled && fields.custom_flow_2_enabled.label) || 'Custom Flow 2: Enabled', helper: (fields.custom_flow_2_enabled && fields.custom_flow_2_enabled.helper) || 'Enable custom flow 2.', selector: { boolean: {} } },
        { name: 'custom_flow_2_sensor', label: (fields.custom_flow_2_sensor && fields.custom_flow_2_sensor.label) || 'Custom Flow 2: Sensor', helper: (fields.custom_flow_2_sensor && fields.custom_flow_2_sensor.helper) || 'Sensor entity that controls this flow (power sensor). Flow direction is based on sensor value sign.', selector: entitySelector },
        { name: 'custom_flow_2_path_preset', label: 'Custom Flow 2: Path Type', helper: 'Choose a preset path shape or Custom to use Start/End coordinates below.', selector: { select: { options: pathPresetOptions } }, default: 'custom' },
        { name: 'custom_flow_2_start_x', label: 'Flow 2: Start X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_2_start_y', label: 'Flow 2: Start Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_2_end_x', label: 'Flow 2: End X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_2_end_y', label: 'Flow 2: End Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_2_path', label: 'Flow 2: SVG Path (Advanced)', helper: 'Manual SVG path (overrides preset if filled).', selector: { text: { multiline: true } } },
        { name: 'custom_flow_2_color', label: (fields.custom_flow_2_color && fields.custom_flow_2_color.label) || 'Custom Flow 2: Color', helper: (fields.custom_flow_2_color && fields.custom_flow_2_color.helper) || 'Color of the flow.', selector: { color_picker: {} } },
        { name: 'custom_flow_2_threshold', label: (fields.custom_flow_2_threshold && fields.custom_flow_2_threshold.label) || 'Custom Flow 2: Threshold (W)', helper: (fields.custom_flow_2_threshold && fields.custom_flow_2_threshold.helper) || 'Minimum power value (in watts) to activate the flow.', selector: { number: { min: 0, max: 10000, step: 10, mode: 'box', unit_of_measurement: 'W' } } },
        { name: 'custom_flow_2_direction', label: (fields.custom_flow_2_direction && fields.custom_flow_2_direction.label) || 'Custom Flow 2: Direction', helper: (fields.custom_flow_2_direction && fields.custom_flow_2_direction.helper) || 'Flow direction: forward (always positive), reverse (always negative), or auto (based on sensor value sign).', selector: { select: { options: [['forward', 'Forward'], ['reverse', 'Reverse'], ['auto', 'Auto']] } } },
        { name: 'custom_flow_2_offset_x', label: (fields.custom_flow_2_offset_x && fields.custom_flow_2_offset_x.label) || 'Custom Flow 2: Offset X (px)', helper: (fields.custom_flow_2_offset_x && fields.custom_flow_2_offset_x.helper) || 'Horizontal offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_2_offset_y', label: (fields.custom_flow_2_offset_y && fields.custom_flow_2_offset_y.label) || 'Custom Flow 2: Offset Y (px)', helper: (fields.custom_flow_2_offset_y && fields.custom_flow_2_offset_y.helper) || 'Vertical offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_3_enabled', label: (fields.custom_flow_3_enabled && fields.custom_flow_3_enabled.label) || 'Custom Flow 3: Enabled', helper: (fields.custom_flow_3_enabled && fields.custom_flow_3_enabled.helper) || 'Enable custom flow 3.', selector: { boolean: {} } },
        { name: 'custom_flow_3_sensor', label: (fields.custom_flow_3_sensor && fields.custom_flow_3_sensor.label) || 'Custom Flow 3: Sensor', helper: (fields.custom_flow_3_sensor && fields.custom_flow_3_sensor.helper) || 'Sensor entity that controls this flow (power sensor). Flow direction is based on sensor value sign.', selector: entitySelector },
        { name: 'custom_flow_3_path_preset', label: 'Custom Flow 3: Path Type', helper: 'Choose a preset path shape or Custom to use Start/End coordinates below.', selector: { select: { options: pathPresetOptions } }, default: 'custom' },
        { name: 'custom_flow_3_start_x', label: 'Flow 3: Start X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_3_start_y', label: 'Flow 3: Start Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_3_end_x', label: 'Flow 3: End X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_3_end_y', label: 'Flow 3: End Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_3_path', label: 'Flow 3: SVG Path (Advanced)', helper: 'Manual SVG path (overrides preset if filled).', selector: { text: { multiline: true } } },
        { name: 'custom_flow_3_color', label: (fields.custom_flow_3_color && fields.custom_flow_3_color.label) || 'Custom Flow 3: Color', helper: (fields.custom_flow_3_color && fields.custom_flow_3_color.helper) || 'Color of the flow.', selector: { color_picker: {} } },
        { name: 'custom_flow_3_threshold', label: (fields.custom_flow_3_threshold && fields.custom_flow_3_threshold.label) || 'Custom Flow 3: Threshold (W)', helper: (fields.custom_flow_3_threshold && fields.custom_flow_3_threshold.helper) || 'Minimum power value (in watts) to activate the flow.', selector: { number: { min: 0, max: 10000, step: 10, mode: 'box', unit_of_measurement: 'W' } } },
        { name: 'custom_flow_3_direction', label: (fields.custom_flow_3_direction && fields.custom_flow_3_direction.label) || 'Custom Flow 3: Direction', helper: (fields.custom_flow_3_direction && fields.custom_flow_3_direction.helper) || 'Flow direction: forward (always positive), reverse (always negative), or auto (based on sensor value sign).', selector: { select: { options: [['forward', 'Forward'], ['reverse', 'Reverse'], ['auto', 'Auto']] } } },
        { name: 'custom_flow_3_offset_x', label: (fields.custom_flow_3_offset_x && fields.custom_flow_3_offset_x.label) || 'Custom Flow 3: Offset X (px)', helper: (fields.custom_flow_3_offset_x && fields.custom_flow_3_offset_x.helper) || 'Horizontal offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_3_offset_y', label: (fields.custom_flow_3_offset_y && fields.custom_flow_3_offset_y.label) || 'Custom Flow 3: Offset Y (px)', helper: (fields.custom_flow_3_offset_y && fields.custom_flow_3_offset_y.helper) || 'Vertical offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_4_enabled', label: (fields.custom_flow_4_enabled && fields.custom_flow_4_enabled.label) || 'Custom Flow 4: Enabled', helper: (fields.custom_flow_4_enabled && fields.custom_flow_4_enabled.helper) || 'Enable custom flow 4.', selector: { boolean: {} } },
        { name: 'custom_flow_4_sensor', label: (fields.custom_flow_4_sensor && fields.custom_flow_4_sensor.label) || 'Custom Flow 4: Sensor', helper: (fields.custom_flow_4_sensor && fields.custom_flow_4_sensor.helper) || 'Sensor entity that controls this flow (power sensor). Flow direction is based on sensor value sign.', selector: entitySelector },
        { name: 'custom_flow_4_path_preset', label: 'Custom Flow 4: Path Type', helper: 'Choose a preset path shape or Custom to use Start/End coordinates below.', selector: { select: { options: pathPresetOptions } }, default: 'custom' },
        { name: 'custom_flow_4_start_x', label: 'Flow 4: Start X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_4_start_y', label: 'Flow 4: Start Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_4_end_x', label: 'Flow 4: End X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_4_end_y', label: 'Flow 4: End Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_4_path', label: 'Flow 4: SVG Path (Advanced)', helper: 'Manual SVG path (overrides preset if filled).', selector: { text: { multiline: true } } },
        { name: 'custom_flow_4_color', label: (fields.custom_flow_4_color && fields.custom_flow_4_color.label) || 'Custom Flow 4: Color', helper: (fields.custom_flow_4_color && fields.custom_flow_4_color.helper) || 'Color of the flow.', selector: { color_picker: {} } },
        { name: 'custom_flow_4_threshold', label: (fields.custom_flow_4_threshold && fields.custom_flow_4_threshold.label) || 'Custom Flow 4: Threshold (W)', helper: (fields.custom_flow_4_threshold && fields.custom_flow_4_threshold.helper) || 'Minimum power value (in watts) to activate the flow.', selector: { number: { min: 0, max: 10000, step: 10, mode: 'box', unit_of_measurement: 'W' } } },
        { name: 'custom_flow_4_direction', label: (fields.custom_flow_4_direction && fields.custom_flow_4_direction.label) || 'Custom Flow 4: Direction', helper: (fields.custom_flow_4_direction && fields.custom_flow_4_direction.helper) || 'Flow direction: forward (always positive), reverse (always negative), or auto (based on sensor value sign).', selector: { select: { options: [['forward', 'Forward'], ['reverse', 'Reverse'], ['auto', 'Auto']] } } },
        { name: 'custom_flow_4_offset_x', label: (fields.custom_flow_4_offset_x && fields.custom_flow_4_offset_x.label) || 'Custom Flow 4: Offset X (px)', helper: (fields.custom_flow_4_offset_x && fields.custom_flow_4_offset_x.helper) || 'Horizontal offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_4_offset_y', label: (fields.custom_flow_4_offset_y && fields.custom_flow_4_offset_y.label) || 'Custom Flow 4: Offset Y (px)', helper: (fields.custom_flow_4_offset_y && fields.custom_flow_4_offset_y.helper) || 'Vertical offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_5_enabled', label: (fields.custom_flow_5_enabled && fields.custom_flow_5_enabled.label) || 'Custom Flow 5: Enabled', helper: (fields.custom_flow_5_enabled && fields.custom_flow_5_enabled.helper) || 'Enable custom flow 5.', selector: { boolean: {} } },
        { name: 'custom_flow_5_sensor', label: (fields.custom_flow_5_sensor && fields.custom_flow_5_sensor.label) || 'Custom Flow 5: Sensor', helper: (fields.custom_flow_5_sensor && fields.custom_flow_5_sensor.helper) || 'Sensor entity that controls this flow (power sensor). Flow direction is based on sensor value sign.', selector: entitySelector },
        { name: 'custom_flow_5_path_preset', label: 'Custom Flow 5: Path Type', helper: 'Choose a preset path shape or Custom to use Start/End coordinates below.', selector: { select: { options: pathPresetOptions } }, default: 'custom' },
        { name: 'custom_flow_5_start_x', label: 'Flow 5: Start X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_5_start_y', label: 'Flow 5: Start Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_5_end_x', label: 'Flow 5: End X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_5_end_y', label: 'Flow 5: End Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_5_path', label: 'Flow 5: SVG Path (Advanced)', helper: 'Manual SVG path (overrides preset if filled).', selector: { text: { multiline: true } } },
        { name: 'custom_flow_5_color', label: (fields.custom_flow_5_color && fields.custom_flow_5_color.label) || 'Custom Flow 5: Color', helper: (fields.custom_flow_5_color && fields.custom_flow_5_color.helper) || 'Color of the flow.', selector: { color_picker: {} } },
        { name: 'custom_flow_5_threshold', label: (fields.custom_flow_5_threshold && fields.custom_flow_5_threshold.label) || 'Custom Flow 5: Threshold (W)', helper: (fields.custom_flow_5_threshold && fields.custom_flow_5_threshold.helper) || 'Minimum power value (in watts) to activate the flow.', selector: { number: { min: 0, max: 10000, step: 10, mode: 'box', unit_of_measurement: 'W' } } },
        { name: 'custom_flow_5_direction', label: (fields.custom_flow_5_direction && fields.custom_flow_5_direction.label) || 'Custom Flow 5: Direction', helper: (fields.custom_flow_5_direction && fields.custom_flow_5_direction.helper) || 'Flow direction: forward (always positive), reverse (always negative), or auto (based on sensor value sign).', selector: { select: { options: [['forward', 'Forward'], ['reverse', 'Reverse'], ['auto', 'Auto']] } } },
        { name: 'custom_flow_5_offset_x', label: (fields.custom_flow_5_offset_x && fields.custom_flow_5_offset_x.label) || 'Custom Flow 5: Offset X (px)', helper: (fields.custom_flow_5_offset_x && fields.custom_flow_5_offset_x.helper) || 'Horizontal offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        { name: 'custom_flow_5_offset_y', label: (fields.custom_flow_5_offset_y && fields.custom_flow_5_offset_y.label) || 'Custom Flow 5: Offset Y (px)', helper: (fields.custom_flow_5_offset_y && fields.custom_flow_5_offset_y.helper) || 'Vertical offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
        
      ]),
      typography: define([
        { name: 'header_font_size', label: fields.header_font_size.label, helper: fields.header_font_size.helper, selector: { text: { mode: 'blur' } } },
        { name: 'daily_label_font_size', label: fields.daily_label_font_size.label, helper: fields.daily_label_font_size.helper, selector: { text: { mode: 'blur' } } },
        { name: 'daily_value_font_size', label: fields.daily_value_font_size.label, helper: fields.daily_value_font_size.helper, selector: { text: { mode: 'blur' } } },
        { name: 'pv_font_size', label: fields.pv_font_size.label, helper: fields.pv_font_size.helper, selector: { text: { mode: 'blur' } } },
        { name: 'battery_soc_font_size', label: fields.battery_soc_font_size.label, helper: fields.battery_soc_font_size.helper, selector: { text: { mode: 'blur' } } },
        { name: 'battery_power_font_size', label: fields.battery_power_font_size.label, helper: fields.battery_power_font_size.helper, selector: { text: { mode: 'blur' } } },
        { name: 'heat_pump_font_size', label: fields.heat_pump_font_size.label, helper: fields.heat_pump_font_size.helper, selector: { text: { mode: 'blur' } } },
        { name: 'grid_font_size', label: fields.grid_font_size.label, helper: fields.grid_font_size.helper, selector: { text: { mode: 'blur' } } },
        { name: 'car_power_font_size', label: fields.car_power_font_size.label, helper: fields.car_power_font_size.helper, selector: { text: { mode: 'blur' } } },
        { name: 'car2_power_font_size', label: (fields.car2_power_font_size && fields.car2_power_font_size.label) || '', helper: (fields.car2_power_font_size && fields.car2_power_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'car_name_font_size', label: (fields.car_name_font_size && fields.car_name_font_size.label) || '', helper: (fields.car_name_font_size && fields.car_name_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'car2_name_font_size', label: (fields.car2_name_font_size && fields.car2_name_font_size.label) || '', helper: (fields.car2_name_font_size && fields.car2_name_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'car_soc_font_size', label: (fields.car_soc_font_size && fields.car_soc_font_size.label) || '', helper: (fields.car_soc_font_size && fields.car_soc_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'car2_soc_font_size', label: (fields.car2_soc_font_size && fields.car2_soc_font_size.label) || '', helper: (fields.car2_soc_font_size && fields.car2_soc_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'sensor_popup_pv_1_font_size', label: (fields.sensor_popup_pv_1_font_size && fields.sensor_popup_pv_1_font_size.label) || '', helper: (fields.sensor_popup_pv_1_font_size && fields.sensor_popup_pv_1_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'sensor_popup_pv_2_font_size', label: (fields.sensor_popup_pv_2_font_size && fields.sensor_popup_pv_2_font_size.label) || '', helper: (fields.sensor_popup_pv_2_font_size && fields.sensor_popup_pv_2_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'sensor_popup_pv_3_font_size', label: (fields.sensor_popup_pv_3_font_size && fields.sensor_popup_pv_3_font_size.label) || '', helper: (fields.sensor_popup_pv_3_font_size && fields.sensor_popup_pv_3_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'sensor_popup_pv_4_font_size', label: (fields.sensor_popup_pv_4_font_size && fields.sensor_popup_pv_4_font_size.label) || '', helper: (fields.sensor_popup_pv_4_font_size && fields.sensor_popup_pv_4_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'sensor_popup_pv_5_font_size', label: (fields.sensor_popup_pv_5_font_size && fields.sensor_popup_pv_5_font_size.label) || '', helper: (fields.sensor_popup_pv_5_font_size && fields.sensor_popup_pv_5_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'sensor_popup_pv_6_font_size', label: (fields.sensor_popup_pv_6_font_size && fields.sensor_popup_pv_6_font_size.label) || '', helper: (fields.sensor_popup_pv_6_font_size && fields.sensor_popup_pv_6_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'sensor_popup_house_1_font_size', label: (fields.sensor_popup_house_1_font_size && fields.sensor_popup_house_1_font_size.label) || '', helper: (fields.sensor_popup_house_1_font_size && fields.sensor_popup_house_1_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'sensor_popup_house_2_font_size', label: (fields.sensor_popup_house_2_font_size && fields.sensor_popup_house_2_font_size.label) || '', helper: (fields.sensor_popup_house_2_font_size && fields.sensor_popup_house_2_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'sensor_popup_house_3_font_size', label: (fields.sensor_popup_house_3_font_size && fields.sensor_popup_house_3_font_size.label) || '', helper: (fields.sensor_popup_house_3_font_size && fields.sensor_popup_house_3_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'sensor_popup_house_4_font_size', label: (fields.sensor_popup_house_4_font_size && fields.sensor_popup_house_4_font_size.label) || '', helper: (fields.sensor_popup_house_4_font_size && fields.sensor_popup_house_4_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'sensor_popup_house_5_font_size', label: (fields.sensor_popup_house_5_font_size && fields.sensor_popup_house_5_font_size.label) || '', helper: (fields.sensor_popup_house_5_font_size && fields.sensor_popup_house_5_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'sensor_popup_house_6_font_size', label: (fields.sensor_popup_house_6_font_size && fields.sensor_popup_house_6_font_size.label) || '', helper: (fields.sensor_popup_house_6_font_size && fields.sensor_popup_house_6_font_size.helper) || '', selector: { text: { mode: 'blur' } } },
        { name: 'sensor_popup_bat_1_font_size', label: (fields.sensor_popup_bat_1_font_size && fields.sensor_popup_bat_1_font_size.label) || '', helper: (fields.sensor_popup_bat_1_font_size && fields.sensor_popup_bat_1_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' },
        { name: 'sensor_popup_bat_2_font_size', label: (fields.sensor_popup_bat_2_font_size && fields.sensor_popup_bat_2_font_size.label) || '', helper: (fields.sensor_popup_bat_2_font_size && fields.sensor_popup_bat_2_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' },
        { name: 'sensor_popup_bat_3_font_size', label: (fields.sensor_popup_bat_3_font_size && fields.sensor_popup_bat_3_font_size.label) || '', helper: (fields.sensor_popup_bat_3_font_size && fields.sensor_popup_bat_3_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' },
        { name: 'sensor_popup_bat_4_font_size', label: (fields.sensor_popup_bat_4_font_size && fields.sensor_popup_bat_4_font_size.label) || '', helper: (fields.sensor_popup_bat_4_font_size && fields.sensor_popup_bat_4_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' },
        { name: 'sensor_popup_bat_5_font_size', label: (fields.sensor_popup_bat_5_font_size && fields.sensor_popup_bat_5_font_size.label) || '', helper: (fields.sensor_popup_bat_5_font_size && fields.sensor_popup_bat_5_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' },
        { name: 'sensor_popup_bat_6_font_size', label: (fields.sensor_popup_bat_6_font_size && fields.sensor_popup_bat_6_font_size.label) || '', helper: (fields.sensor_popup_bat_6_font_size && fields.sensor_popup_bat_6_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' }
        ,{ name: 'sensor_popup_grid_1_font_size', label: (fields.sensor_popup_grid_1_font_size && fields.sensor_popup_grid_1_font_size.label) || '', helper: (fields.sensor_popup_grid_1_font_size && fields.sensor_popup_grid_1_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' }
        ,{ name: 'sensor_popup_grid_2_font_size', label: (fields.sensor_popup_grid_2_font_size && fields.sensor_popup_grid_2_font_size.label) || '', helper: (fields.sensor_popup_grid_2_font_size && fields.sensor_popup_grid_2_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' }
        ,{ name: 'sensor_popup_grid_3_font_size', label: (fields.sensor_popup_grid_3_font_size && fields.sensor_popup_grid_3_font_size.label) || '', helper: (fields.sensor_popup_grid_3_font_size && fields.sensor_popup_grid_3_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' }
        ,{ name: 'sensor_popup_grid_4_font_size', label: (fields.sensor_popup_grid_4_font_size && fields.sensor_popup_grid_4_font_size.label) || '', helper: (fields.sensor_popup_grid_4_font_size && fields.sensor_popup_grid_4_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' }
        ,{ name: 'sensor_popup_grid_5_font_size', label: (fields.sensor_popup_grid_5_font_size && fields.sensor_popup_grid_5_font_size.label) || '', helper: (fields.sensor_popup_grid_5_font_size && fields.sensor_popup_grid_5_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' }
        ,{ name: 'sensor_popup_grid_6_font_size', label: (fields.sensor_popup_grid_6_font_size && fields.sensor_popup_grid_6_font_size.label) || '', helper: (fields.sensor_popup_grid_6_font_size && fields.sensor_popup_grid_6_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' }
        ,{ name: 'sensor_popup_inverter_1_font_size', label: (fields.sensor_popup_inverter_1_font_size && fields.sensor_popup_inverter_1_font_size.label) || '', helper: (fields.sensor_popup_inverter_1_font_size && fields.sensor_popup_inverter_1_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' }
        ,{ name: 'sensor_popup_inverter_2_font_size', label: (fields.sensor_popup_inverter_2_font_size && fields.sensor_popup_inverter_2_font_size.label) || '', helper: (fields.sensor_popup_inverter_2_font_size && fields.sensor_popup_inverter_2_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' }
        ,{ name: 'sensor_popup_inverter_3_font_size', label: (fields.sensor_popup_inverter_3_font_size && fields.sensor_popup_inverter_3_font_size.label) || '', helper: (fields.sensor_popup_inverter_3_font_size && fields.sensor_popup_inverter_3_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' }
        ,{ name: 'sensor_popup_inverter_4_font_size', label: (fields.sensor_popup_inverter_4_font_size && fields.sensor_popup_inverter_4_font_size.label) || '', helper: (fields.sensor_popup_inverter_4_font_size && fields.sensor_popup_inverter_4_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' }
        ,{ name: 'sensor_popup_inverter_5_font_size', label: (fields.sensor_popup_inverter_5_font_size && fields.sensor_popup_inverter_5_font_size.label) || '', helper: (fields.sensor_popup_inverter_5_font_size && fields.sensor_popup_inverter_5_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' }
        ,{ name: 'sensor_popup_inverter_6_font_size', label: (fields.sensor_popup_inverter_6_font_size && fields.sensor_popup_inverter_6_font_size.label) || '', helper: (fields.sensor_popup_inverter_6_font_size && fields.sensor_popup_inverter_6_font_size.helper) || '', selector: { text: { mode: 'blur' } }, default: '16' }
      ]),
      pvPopup: define(createPopupSchemaFields('pv', 6)),
      batteryPopup: define(createPopupSchemaFields('bat', 6)),
      gridPopup: define(createPopupSchemaFields('grid', 6)),
      inverterPopup: define(createPopupSchemaFields('inverter', 6)),
      housePopup: define([
        ...createPopupSchemaFields('house', 6),
        { name: 'house_text_color', label: (fields.house_text_color && fields.house_text_color.label) || 'Home Text Color', helper: (fields.house_text_color && fields.house_text_color.helper) || 'Color for load and temperature.', selector: { color_picker: {} }, default: '#00f9f9' },
        { name: 'house_font_size', label: (fields.house_font_size && fields.house_font_size.label) || 'Home Font Size (px)', helper: (fields.house_font_size && fields.house_font_size.helper) || 'Font size for load and temperature.', selector: { number: { min: 8, max: 32, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 12 },
        { name: 'load_text_color', label: fields.load_text_color.label, helper: fields.load_text_color.helper, selector: { color_picker: {} }, default: '#00f9f9' },
        { name: 'load_font_size', label: (fields.load_font_size && fields.load_font_size.label) || 'Load Font Size (px)', helper: (fields.load_font_size && fields.load_font_size.helper) || 'Font size for load text.', selector: { number: { min: 8, max: 32, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 12 },
      ]),
      layout: define([
        ...createLayoutFields('solar', 'Solar'),
        ...createLayoutFields('battery', 'Battery'),
        ...createLayoutFields('home', 'Home'),
        ...createLayoutFields('home_temperature', 'Home Temperature'),
        ...createLayoutFields('grid', 'Grid'),
        ...createLayoutFields('heatPump', 'Heat Pump'),
        ...createLayoutFields('car1_label', 'Car 1 Label'),
        ...createLayoutFields('car2_label', 'Car 2 Label'),
        ...createLayoutFields('car1_power', 'Car 1 Power'),
        ...createLayoutFields('car1_soc', 'Car 1 %'),
        ...createLayoutFields('car2_power', 'Car 2 Power'),
        ...createLayoutFields('car2_soc', 'Car 2 %')
      ]),
      socBar: define([
        { name: 'dev_soc_bar_x', label: (fields.dev_soc_bar_x && fields.dev_soc_bar_x.label) || 'SOC Bar X (px)', helper: (fields.dev_soc_bar_x && fields.dev_soc_bar_x.helper) || 'Horizontal position. ViewBox 0–800. Path M 330,370 360,360 350,270 320,280 Z → 325.', selector: { number: { min: 0, max: 800, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 325 },
        { name: 'dev_soc_bar_y', label: (fields.dev_soc_bar_y && fields.dev_soc_bar_y.label) || 'SOC Bar Y (px)', helper: (fields.dev_soc_bar_y && fields.dev_soc_bar_y.helper) || 'Vertical position. ViewBox 0–450.', selector: { number: { min: 0, max: 450, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 277 },
        { name: 'dev_soc_bar_width', label: (fields.dev_soc_bar_width && fields.dev_soc_bar_width.label) || 'SOC Bar Width (px)', helper: (fields.dev_soc_bar_width && fields.dev_soc_bar_width.helper) || 'Bar width. Path bbox 30.', selector: { number: { min: 10, max: 120, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 30 },
        { name: 'dev_soc_bar_height', label: (fields.dev_soc_bar_height && fields.dev_soc_bar_height.label) || 'SOC Bar Height (px)', helper: (fields.dev_soc_bar_height && fields.dev_soc_bar_height.helper) || 'Bar height. Path bbox 85.', selector: { number: { min: 20, max: 200, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 85 },
        { name: 'dev_soc_bar_rotate', label: (fields.dev_soc_bar_rotate && fields.dev_soc_bar_rotate.label) || 'SOC Bar Rotate (°)', helper: (fields.dev_soc_bar_rotate && fields.dev_soc_bar_rotate.helper) || 'Rotation 0–360°. Use -180…180 for full circle.', selector: { number: { min: -180, max: 180, step: 1, mode: 'slider', unit_of_measurement: '°' } }, default: 1 },
        { name: 'dev_soc_bar_skew_x', label: (fields.dev_soc_bar_skew_x && fields.dev_soc_bar_skew_x.label) || 'SOC Bar Skew X (°)', helper: (fields.dev_soc_bar_skew_x && fields.dev_soc_bar_skew_x.helper) || 'Horizontal skew angle in degrees.', selector: { number: { min: -45, max: 45, step: 1, mode: 'slider', unit_of_measurement: '°' } }, default: 2 },
        { name: 'dev_soc_bar_skew_y', label: (fields.dev_soc_bar_skew_y && fields.dev_soc_bar_skew_y.label) || 'SOC Bar Skew Y (°)', helper: (fields.dev_soc_bar_skew_y && fields.dev_soc_bar_skew_y.helper) || 'Vertical skew angle in degrees.', selector: { number: { min: -45, max: 45, step: 1, mode: 'slider', unit_of_measurement: '°' } }, default: -19 },
        { name: 'soc_bar_opacity', label: (fields.soc_bar_opacity && fields.soc_bar_opacity.label) || 'SOC Bar Opacity', helper: (fields.soc_bar_opacity && fields.soc_bar_opacity.helper) || 'Transparency 0.05–1.', selector: { number: { min: 0.05, max: 1, step: 0.05, mode: 'slider' } }, default: 0.55 },
        { name: 'soc_bar_glow', label: (fields.soc_bar_glow && fields.soc_bar_glow.label) || 'SOC Bar Glow (px)', helper: (fields.soc_bar_glow && fields.soc_bar_glow.helper) || 'Drop-shadow blur on lit segments. 0 = off.', selector: { number: { min: 0, max: 30, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 13 },
        { name: 'soc_bar_color_on', label: (fields.soc_bar_color_on && fields.soc_bar_color_on.label) || 'SOC Bar Color (lit)', helper: (fields.soc_bar_color_on && fields.soc_bar_color_on.helper) || 'Segment color when lit by SOC.', selector: { color_picker: {} }, default: '#00FFFF' },
        { name: 'soc_bar_color_off', label: (fields.soc_bar_color_off && fields.soc_bar_color_off.label) || 'SOC Bar Color (off)', helper: (fields.soc_bar_color_off && fields.soc_bar_color_off.helper) || 'Segment color when not lit.', selector: { color_picker: {} }, default: '#5aa7c3' }
      ]),
      gridBox: define([
        { name: 'dev_grid_box_x', label: (fields.dev_grid_box_x && fields.dev_grid_box_x.label) || 'Grid Box X (px)', helper: (fields.dev_grid_box_x && fields.dev_grid_box_x.helper) || 'Top-right box. Import/Export + daily.', selector: { number: { min: 0, max: 800, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
        { name: 'dev_grid_box_y', label: (fields.dev_grid_box_y && fields.dev_grid_box_y.label) || 'Grid Box Y (px)', helper: (fields.dev_grid_box_y && fields.dev_grid_box_y.helper) || 'Vertical position.', selector: { number: { min: 0, max: 450, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
        { name: 'dev_grid_box_width', label: (fields.dev_grid_box_width && fields.dev_grid_box_width.label) || 'Grid Box Width (px)', helper: (fields.dev_grid_box_width && fields.dev_grid_box_width.helper) || '', selector: { number: { min: 120, max: 300, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
        { name: 'dev_grid_box_height', label: (fields.dev_grid_box_height && fields.dev_grid_box_height.label) || 'Grid Box Height (px)', helper: (fields.dev_grid_box_height && fields.dev_grid_box_height.helper) || '', selector: { number: { min: 60, max: 150, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
        { name: 'dev_grid_box_font_size', label: (fields.dev_grid_box_font_size && fields.dev_grid_box_font_size.label) || 'Grid Box Font Size (px)', helper: (fields.dev_grid_box_font_size && fields.dev_grid_box_font_size.helper) || 'Font size for text in grid box. Leave empty for auto scaling.', selector: { number: { min: 8, max: 24, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
        { name: 'dev_grid_box_text_color', label: (fields.dev_grid_box_text_color && fields.dev_grid_box_text_color.label) || 'Grid Box Text Color', helper: (fields.dev_grid_box_text_color && fields.dev_grid_box_text_color.helper) || 'Color for all text in grid box. Leave empty to use individual colors.', selector: { color_picker: {} } }
      ]),
      pvBox: define([
        { name: 'dev_pv_box_x', label: (fields.dev_pv_box_x && fields.dev_pv_box_x.label) || 'PV Box X (px)', helper: (fields.dev_pv_box_x && fields.dev_pv_box_x.helper) || 'Top-left box. PV Total (sum) + Daily production.', selector: { number: { min: 0, max: 800, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
        { name: 'dev_pv_box_y', label: (fields.dev_pv_box_y && fields.dev_pv_box_y.label) || 'PV Box Y (px)', helper: (fields.dev_pv_box_y && fields.dev_pv_box_y.helper) || 'Vertical position.', selector: { number: { min: 0, max: 450, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
        { name: 'dev_pv_box_width', label: (fields.dev_pv_box_width && fields.dev_pv_box_width.label) || 'PV Box Width (px)', helper: (fields.dev_pv_box_width && fields.dev_pv_box_width.helper) || '', selector: { number: { min: 120, max: 300, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
        { name: 'dev_pv_box_height', label: (fields.dev_pv_box_height && fields.dev_pv_box_height.label) || 'PV Box Height (px)', helper: (fields.dev_pv_box_height && fields.dev_pv_box_height.helper) || '', selector: { number: { min: 60, max: 150, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
        { name: 'dev_pv_box_font_size', label: (fields.dev_pv_box_font_size && fields.dev_pv_box_font_size.label) || 'PV Box Font Size (px)', helper: (fields.dev_pv_box_font_size && fields.dev_pv_box_font_size.helper) || 'Font size for text in PV box. Leave empty for auto scaling.', selector: { number: { min: 8, max: 24, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
        { name: 'dev_pv_box_text_color', label: (fields.dev_pv_box_text_color && fields.dev_pv_box_text_color.label) || 'PV Box Text Color', helper: (fields.dev_pv_box_text_color && fields.dev_pv_box_text_color.helper) || 'Color for all text in PV box. Leave empty to use PV total color.', selector: { color_picker: {} } }
      ]),
      lumina_pro: define([
      { name: 'pro_password', label: (fields.pro_password && fields.pro_password.label) ? fields.pro_password.label : 'PRO Password', helper: (fields.pro_password && fields.pro_password.helper) ? fields.pro_password.helper : '⚠️ PRO FEATURE: Enter PRO password to unlock premium features. To unlock: send 1€ to PayPal (3dprint8616@gmail.com) with your email in the message.', selector: { text: { type: 'password' } } },
      { name: 'text_visibility_sensor', label: fields.text_visibility_sensor.label, helper: fields.text_visibility_sensor.helper, selector: motionSensorSelector },

      // Overlay Image fields
      { name: 'overlay_image_enabled', label: (fields.overlay_image_enabled && fields.overlay_image_enabled.label) || 'Enable Overlay Image', helper: (fields.overlay_image_enabled && fields.overlay_image_enabled.helper) || '⚠️ Requires valid PRO password above. Enable or disable the overlay image.', selector: { boolean: {} } },
      { name: 'overlay_image', label: (fields.overlay_image && fields.overlay_image.label) || 'Overlay Image Path', helper: (fields.overlay_image && fields.overlay_image.helper) || 'Path to an overlay PNG image to display on top of the background (e.g., /local/community/lumina-energy-card/overlay.png).', selector: { text: { mode: 'blur' } } },
      { name: 'overlay_image_x', label: (fields.overlay_image_x && fields.overlay_image_x.label) || 'Overlay Image X Position (px)', helper: (fields.overlay_image_x && fields.overlay_image_x.helper) || 'Horizontal position of the overlay image. Default: 0.', selector: { number: { min: -800, max: 1600, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_y', label: (fields.overlay_image_y && fields.overlay_image_y.label) || 'Overlay Image Y Position (px)', helper: (fields.overlay_image_y && fields.overlay_image_y.helper) || 'Vertical position of the overlay image. Default: 0.', selector: { number: { min: -450, max: 900, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_width', label: (fields.overlay_image_width && fields.overlay_image_width.label) || 'Overlay Image Width (px)', helper: (fields.overlay_image_width && fields.overlay_image_width.helper) || 'Width of the overlay image. Default: 800.', selector: { number: { min: 1, max: 1600, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_height', label: (fields.overlay_image_height && fields.overlay_image_height.label) || 'Overlay Image Height (px)', helper: (fields.overlay_image_height && fields.overlay_image_height.helper) || 'Height of the overlay image. Default: 450.', selector: { number: { min: 1, max: 900, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_opacity', label: (fields.overlay_image_opacity && fields.overlay_image_opacity.label) || 'Overlay Image Opacity', helper: (fields.overlay_image_opacity && fields.overlay_image_opacity.helper) || 'Opacity of the overlay image (0.0 to 1.0). Default: 1.0.', selector: { number: { min: 0, max: 1, step: 0.1, mode: 'slider' } } },
      { name: 'overlay_image_2_enabled', label: (fields.overlay_image_2_enabled && fields.overlay_image_2_enabled.label) || 'Enable Overlay Image 2', helper: (fields.overlay_image_2_enabled && fields.overlay_image_2_enabled.helper) || '⚠️ Requires valid PRO password above. Enable or disable the second overlay image.', selector: { boolean: {} } },
      { name: 'overlay_image_2', label: (fields.overlay_image_2 && fields.overlay_image_2.label) || 'Overlay Image 2 Path', helper: (fields.overlay_image_2 && fields.overlay_image_2.helper) || 'Path to a second overlay PNG image to display on top of the background (e.g., /local/community/lumina-energy-card/overlay2.png).', selector: { text: { mode: 'blur' } } },
      { name: 'overlay_image_2_x', label: (fields.overlay_image_2_x && fields.overlay_image_2_x.label) || 'Overlay Image 2 X Position (px)', helper: (fields.overlay_image_2_x && fields.overlay_image_2_x.helper) || 'Horizontal position of the second overlay image. Default: 0.', selector: { number: { min: -800, max: 1600, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_2_y', label: (fields.overlay_image_2_y && fields.overlay_image_2_y.label) || 'Overlay Image 2 Y Position (px)', helper: (fields.overlay_image_2_y && fields.overlay_image_2_y.helper) || 'Vertical position of the second overlay image. Default: 0.', selector: { number: { min: -450, max: 900, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_2_width', label: (fields.overlay_image_2_width && fields.overlay_image_2_width.label) || 'Overlay Image 2 Width (px)', helper: (fields.overlay_image_2_width && fields.overlay_image_2_width.helper) || 'Width of the second overlay image. Default: 800.', selector: { number: { min: 1, max: 1600, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_2_height', label: (fields.overlay_image_2_height && fields.overlay_image_2_height.label) || 'Overlay Image 2 Height (px)', helper: (fields.overlay_image_2_height && fields.overlay_image_2_height.helper) || 'Height of the second overlay image. Default: 450.', selector: { number: { min: 1, max: 900, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_2_opacity', label: (fields.overlay_image_2_opacity && fields.overlay_image_2_opacity.label) || 'Overlay Image 2 Opacity', helper: (fields.overlay_image_2_opacity && fields.overlay_image_2_opacity.helper) || 'Opacity of the second overlay image (0.0 to 1.0). Default: 1.0.', selector: { number: { min: 0, max: 1, step: 0.1, mode: 'slider' } } },
      { name: 'overlay_image_3_enabled', label: (fields.overlay_image_3_enabled && fields.overlay_image_3_enabled.label) || 'Enable Overlay Image 3', helper: (fields.overlay_image_3_enabled && fields.overlay_image_3_enabled.helper) || '⚠️ Requires valid PRO password above. Enable or disable the third overlay image.', selector: { boolean: {} } },
      { name: 'overlay_image_3', label: (fields.overlay_image_3 && fields.overlay_image_3.label) || 'Overlay Image 3 Path', helper: (fields.overlay_image_3 && fields.overlay_image_3.helper) || 'Path to a third overlay PNG image to display on top of the background (e.g., /local/community/lumina-energy-card/overlay3.png).', selector: { text: { mode: 'blur' } } },
      { name: 'overlay_image_3_x', label: (fields.overlay_image_3_x && fields.overlay_image_3_x.label) || 'Overlay Image 3 X Position (px)', helper: (fields.overlay_image_3_x && fields.overlay_image_3_x.helper) || 'Horizontal position of the third overlay image. Default: 0.', selector: { number: { min: -800, max: 1600, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_3_y', label: (fields.overlay_image_3_y && fields.overlay_image_3_y.label) || 'Overlay Image 3 Y Position (px)', helper: (fields.overlay_image_3_y && fields.overlay_image_3_y.helper) || 'Vertical position of the third overlay image. Default: 0.', selector: { number: { min: -450, max: 900, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_3_width', label: (fields.overlay_image_3_width && fields.overlay_image_3_width.label) || 'Overlay Image 3 Width (px)', helper: (fields.overlay_image_3_width && fields.overlay_image_3_width.helper) || 'Width of the third overlay image. Default: 800.', selector: { number: { min: 1, max: 1600, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_3_height', label: (fields.overlay_image_3_height && fields.overlay_image_3_height.label) || 'Overlay Image 3 Height (px)', helper: (fields.overlay_image_3_height && fields.overlay_image_3_height.helper) || 'Height of the third overlay image. Default: 450.', selector: { number: { min: 1, max: 900, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_3_opacity', label: (fields.overlay_image_3_opacity && fields.overlay_image_3_opacity.label) || 'Overlay Image 3 Opacity', helper: (fields.overlay_image_3_opacity && fields.overlay_image_3_opacity.helper) || 'Opacity of the third overlay image (0.0 to 1.0). Default: 1.0.', selector: { number: { min: 0, max: 1, step: 0.1, mode: 'slider' } } },
      { name: 'overlay_image_4_enabled', label: (fields.overlay_image_4_enabled && fields.overlay_image_4_enabled.label) || 'Enable Overlay Image 4', helper: (fields.overlay_image_4_enabled && fields.overlay_image_4_enabled.helper) || '⚠️ Requires valid PRO password above. Enable or disable the fourth overlay image.', selector: { boolean: {} } },
      { name: 'overlay_image_4', label: (fields.overlay_image_4 && fields.overlay_image_4.label) || 'Overlay Image 4 Path', helper: (fields.overlay_image_4 && fields.overlay_image_4.helper) || 'Path to a fourth overlay PNG image to display on top of the background (e.g., /local/community/lumina-energy-card/overlay4.png).', selector: { text: { mode: 'blur' } } },
      { name: 'overlay_image_4_x', label: (fields.overlay_image_4_x && fields.overlay_image_4_x.label) || 'Overlay Image 4 X Position (px)', helper: (fields.overlay_image_4_x && fields.overlay_image_4_x.helper) || 'Horizontal position of the fourth overlay image. Default: 0.', selector: { number: { min: -800, max: 1600, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_4_y', label: (fields.overlay_image_4_y && fields.overlay_image_4_y.label) || 'Overlay Image 4 Y Position (px)', helper: (fields.overlay_image_4_y && fields.overlay_image_4_y.helper) || 'Vertical position of the fourth overlay image. Default: 0.', selector: { number: { min: -450, max: 900, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_4_width', label: (fields.overlay_image_4_width && fields.overlay_image_4_width.label) || 'Overlay Image 4 Width (px)', helper: (fields.overlay_image_4_width && fields.overlay_image_4_width.helper) || 'Width of the fourth overlay image. Default: 800.', selector: { number: { min: 1, max: 1600, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_4_height', label: (fields.overlay_image_4_height && fields.overlay_image_4_height.label) || 'Overlay Image 4 Height (px)', helper: (fields.overlay_image_4_height && fields.overlay_image_4_height.helper) || 'Height of the fourth overlay image. Default: 450.', selector: { number: { min: 1, max: 900, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_4_opacity', label: (fields.overlay_image_4_opacity && fields.overlay_image_4_opacity.label) || 'Overlay Image 4 Opacity', helper: (fields.overlay_image_4_opacity && fields.overlay_image_4_opacity.helper) || 'Opacity of the fourth overlay image (0.0 to 1.0). Default: 1.0.', selector: { number: { min: 0, max: 1, step: 0.1, mode: 'slider' } } },
      { name: 'overlay_image_5_enabled', label: (fields.overlay_image_5_enabled && fields.overlay_image_5_enabled.label) || 'Enable Overlay Image 5', helper: (fields.overlay_image_5_enabled && fields.overlay_image_5_enabled.helper) || '⚠️ Requires valid PRO password above. Enable or disable the fifth overlay image.', selector: { boolean: {} } },
      { name: 'overlay_image_5', label: (fields.overlay_image_5 && fields.overlay_image_5.label) || 'Overlay Image 5 Path', helper: (fields.overlay_image_5 && fields.overlay_image_5.helper) || 'Path to a fifth overlay PNG image to display on top of the background (e.g., /local/community/lumina-energy-card/overlay5.png).', selector: { text: { mode: 'blur' } } },
      { name: 'overlay_image_5_x', label: (fields.overlay_image_5_x && fields.overlay_image_5_x.label) || 'Overlay Image 5 X Position (px)', helper: (fields.overlay_image_5_x && fields.overlay_image_5_x.helper) || 'Horizontal position of the fifth overlay image. Default: 0.', selector: { number: { min: -800, max: 1600, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_5_y', label: (fields.overlay_image_5_y && fields.overlay_image_5_y.label) || 'Overlay Image 5 Y Position (px)', helper: (fields.overlay_image_5_y && fields.overlay_image_5_y.helper) || 'Vertical position of the fifth overlay image. Default: 0.', selector: { number: { min: -450, max: 900, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_5_width', label: (fields.overlay_image_5_width && fields.overlay_image_5_width.label) || 'Overlay Image 5 Width (px)', helper: (fields.overlay_image_5_width && fields.overlay_image_5_width.helper) || 'Width of the fifth overlay image. Default: 800.', selector: { number: { min: 1, max: 1600, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_5_height', label: (fields.overlay_image_5_height && fields.overlay_image_5_height.label) || 'Overlay Image 5 Height (px)', helper: (fields.overlay_image_5_height && fields.overlay_image_5_height.helper) || 'Height of the fifth overlay image. Default: 450.', selector: { number: { min: 1, max: 900, step: 1, mode: 'slider', unit_of_measurement: 'px' } } },
      { name: 'overlay_image_5_opacity', label: (fields.overlay_image_5_opacity && fields.overlay_image_5_opacity.label) || 'Overlay Image 5 Opacity', helper: (fields.overlay_image_5_opacity && fields.overlay_image_5_opacity.helper) || 'Opacity of the fifth overlay image (0.0 to 1.0). Default: 1.0.', selector: { number: { min: 0, max: 1, step: 0.1, mode: 'slider' } } },

      // Custom Flows fields
      { name: 'custom_flow_1_enabled', label: (fields.custom_flow_1_enabled && fields.custom_flow_1_enabled.label) || 'Custom Flow 1: Enabled', helper: (fields.custom_flow_1_enabled && fields.custom_flow_1_enabled.helper) || 'Enable custom flow 1.', selector: { boolean: {} } },
      { name: 'custom_flow_1_sensor', label: (fields.custom_flow_1_sensor && fields.custom_flow_1_sensor.label) || 'Custom Flow 1: Sensor', helper: (fields.custom_flow_1_sensor && fields.custom_flow_1_sensor.helper) || 'Sensor entity that controls this flow (power sensor). Flow direction is based on sensor value sign.', selector: entitySelector },
      { name: 'custom_flow_1_path_preset', label: 'Custom Flow 1: Path Type', helper: 'Choose a preset path shape or Custom to use Start/End coordinates below.', selector: { select: { options: pathPresetOptions } }, default: 'custom' },
      { name: 'custom_flow_1_start_x', label: 'Flow 1: Start X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_1_start_y', label: 'Flow 1: Start Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_1_end_x', label: 'Flow 1: End X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_1_end_y', label: 'Flow 1: End Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_1_path', label: 'Flow 1: SVG Path (Advanced)', helper: 'Manual SVG path (overrides preset if filled).', selector: { text: { multiline: true } } },
      { name: 'custom_flow_1_color', label: (fields.custom_flow_1_color && fields.custom_flow_1_color.label) || 'Custom Flow 1: Color', helper: (fields.custom_flow_1_color && fields.custom_flow_1_color.helper) || 'Color of the flow.', selector: { color_picker: {} } },
      { name: 'custom_flow_1_threshold', label: (fields.custom_flow_1_threshold && fields.custom_flow_1_threshold.label) || 'Custom Flow 1: Threshold (W)', helper: (fields.custom_flow_1_threshold && fields.custom_flow_1_threshold.helper) || 'Minimum power value (in watts) to activate the flow.', selector: { number: { min: 0, max: 10000, step: 10, mode: 'box', unit_of_measurement: 'W' } } },
      { name: 'custom_flow_1_direction', label: (fields.custom_flow_1_direction && fields.custom_flow_1_direction.label) || 'Custom Flow 1: Direction', helper: (fields.custom_flow_1_direction && fields.custom_flow_1_direction.helper) || 'Flow direction: forward (always positive), reverse (always negative), or auto (based on sensor value sign).', selector: { select: { options: [['forward', 'Forward'], ['reverse', 'Reverse'], ['auto', 'Auto']] } } },
      { name: 'custom_flow_1_offset_x', label: (fields.custom_flow_1_offset_x && fields.custom_flow_1_offset_x.label) || 'Custom Flow 1: Offset X (px)', helper: (fields.custom_flow_1_offset_x && fields.custom_flow_1_offset_x.helper) || 'Horizontal offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_1_offset_y', label: (fields.custom_flow_1_offset_y && fields.custom_flow_1_offset_y.label) || 'Custom Flow 1: Offset Y (px)', helper: (fields.custom_flow_1_offset_y && fields.custom_flow_1_offset_y.helper) || 'Vertical offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },

      { name: 'custom_flow_2_enabled', label: (fields.custom_flow_2_enabled && fields.custom_flow_2_enabled.label) || 'Custom Flow 2: Enabled', helper: (fields.custom_flow_2_enabled && fields.custom_flow_2_enabled.helper) || 'Enable custom flow 2.', selector: { boolean: {} } },
      { name: 'custom_flow_2_sensor', label: (fields.custom_flow_2_sensor && fields.custom_flow_2_sensor.label) || 'Custom Flow 2: Sensor', helper: (fields.custom_flow_2_sensor && fields.custom_flow_2_sensor.helper) || 'Sensor entity that controls this flow (power sensor). Flow direction is based on sensor value sign.', selector: entitySelector },
      { name: 'custom_flow_2_path_preset', label: 'Custom Flow 2: Path Type', helper: 'Choose a preset path shape or Custom to use Start/End coordinates below.', selector: { select: { options: pathPresetOptions } }, default: 'custom' },
      { name: 'custom_flow_2_start_x', label: 'Flow 2: Start X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_2_start_y', label: 'Flow 2: Start Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_2_end_x', label: 'Flow 2: End X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_2_end_y', label: 'Flow 2: End Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_2_path', label: 'Flow 2: SVG Path (Advanced)', helper: 'Manual SVG path (overrides preset if filled).', selector: { text: { multiline: true } } },
      { name: 'custom_flow_2_color', label: (fields.custom_flow_2_color && fields.custom_flow_2_color.label) || 'Custom Flow 2: Color', helper: (fields.custom_flow_2_color && fields.custom_flow_2_color.helper) || 'Color of the flow.', selector: { color_picker: {} } },
      { name: 'custom_flow_2_threshold', label: (fields.custom_flow_2_threshold && fields.custom_flow_2_threshold.label) || 'Custom Flow 2: Threshold (W)', helper: (fields.custom_flow_2_threshold && fields.custom_flow_2_threshold.helper) || 'Minimum power value (in watts) to activate the flow.', selector: { number: { min: 0, max: 10000, step: 10, mode: 'box', unit_of_measurement: 'W' } } },
      { name: 'custom_flow_2_direction', label: (fields.custom_flow_2_direction && fields.custom_flow_2_direction.label) || 'Custom Flow 2: Direction', helper: (fields.custom_flow_2_direction && fields.custom_flow_2_direction.helper) || 'Flow direction: forward (always positive), reverse (always negative), or auto (based on sensor value sign).', selector: { select: { options: [['forward', 'Forward'], ['reverse', 'Reverse'], ['auto', 'Auto']] } } },
      { name: 'custom_flow_2_offset_x', label: (fields.custom_flow_2_offset_x && fields.custom_flow_2_offset_x.label) || 'Custom Flow 2: Offset X (px)', helper: (fields.custom_flow_2_offset_x && fields.custom_flow_2_offset_x.helper) || 'Horizontal offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_2_offset_y', label: (fields.custom_flow_2_offset_y && fields.custom_flow_2_offset_y.label) || 'Custom Flow 2: Offset Y (px)', helper: (fields.custom_flow_2_offset_y && fields.custom_flow_2_offset_y.helper) || 'Vertical offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },

      { name: 'custom_flow_3_enabled', label: (fields.custom_flow_3_enabled && fields.custom_flow_3_enabled.label) || 'Custom Flow 3: Enabled', helper: (fields.custom_flow_3_enabled && fields.custom_flow_3_enabled.helper) || 'Enable custom flow 3.', selector: { boolean: {} } },
      { name: 'custom_flow_3_sensor', label: (fields.custom_flow_3_sensor && fields.custom_flow_3_sensor.label) || 'Custom Flow 3: Sensor', helper: (fields.custom_flow_3_sensor && fields.custom_flow_3_sensor.helper) || 'Sensor entity that controls this flow (power sensor). Flow direction is based on sensor value sign.', selector: entitySelector },
      { name: 'custom_flow_3_path_preset', label: 'Custom Flow 3: Path Type', helper: 'Choose a preset path shape or Custom to use Start/End coordinates below.', selector: { select: { options: pathPresetOptions } }, default: 'custom' },
      { name: 'custom_flow_3_start_x', label: 'Flow 3: Start X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_3_start_y', label: 'Flow 3: Start Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_3_end_x', label: 'Flow 3: End X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_3_end_y', label: 'Flow 3: End Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_3_path', label: 'Flow 3: SVG Path (Advanced)', helper: 'Manual SVG path (overrides preset if filled).', selector: { text: { multiline: true } } },
      { name: 'custom_flow_3_color', label: (fields.custom_flow_3_color && fields.custom_flow_3_color.label) || 'Custom Flow 3: Color', helper: (fields.custom_flow_3_color && fields.custom_flow_3_color.helper) || 'Color of the flow.', selector: { color_picker: {} } },
      { name: 'custom_flow_3_threshold', label: (fields.custom_flow_3_threshold && fields.custom_flow_3_threshold.label) || 'Custom Flow 3: Threshold (W)', helper: (fields.custom_flow_3_threshold && fields.custom_flow_3_threshold.helper) || 'Minimum power value (in watts) to activate the flow.', selector: { number: { min: 0, max: 10000, step: 10, mode: 'box', unit_of_measurement: 'W' } } },
      { name: 'custom_flow_3_direction', label: (fields.custom_flow_3_direction && fields.custom_flow_3_direction.label) || 'Custom Flow 3: Direction', helper: (fields.custom_flow_3_direction && fields.custom_flow_3_direction.helper) || 'Flow direction: forward (always positive), reverse (always negative), or auto (based on sensor value sign).', selector: { select: { options: [['forward', 'Forward'], ['reverse', 'Reverse'], ['auto', 'Auto']] } } },
      { name: 'custom_flow_3_offset_x', label: (fields.custom_flow_3_offset_x && fields.custom_flow_3_offset_x.label) || 'Custom Flow 3: Offset X (px)', helper: (fields.custom_flow_3_offset_x && fields.custom_flow_3_offset_x.helper) || 'Horizontal offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_3_offset_y', label: (fields.custom_flow_3_offset_y && fields.custom_flow_3_offset_y.label) || 'Custom Flow 3: Offset Y (px)', helper: (fields.custom_flow_3_offset_y && fields.custom_flow_3_offset_y.helper) || 'Vertical offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },

      { name: 'custom_flow_4_enabled', label: (fields.custom_flow_4_enabled && fields.custom_flow_4_enabled.label) || 'Custom Flow 4: Enabled', helper: (fields.custom_flow_4_enabled && fields.custom_flow_4_enabled.helper) || 'Enable custom flow 4.', selector: { boolean: {} } },
      { name: 'custom_flow_4_sensor', label: (fields.custom_flow_4_sensor && fields.custom_flow_4_sensor.label) || 'Custom Flow 4: Sensor', helper: (fields.custom_flow_4_sensor && fields.custom_flow_4_sensor.helper) || 'Sensor entity that controls this flow (power sensor). Flow direction is based on sensor value sign.', selector: entitySelector },
      { name: 'custom_flow_4_path_preset', label: 'Custom Flow 4: Path Type', helper: 'Choose a preset path shape or Custom to use Start/End coordinates below.', selector: { select: { options: pathPresetOptions } }, default: 'custom' },
      { name: 'custom_flow_4_start_x', label: 'Flow 4: Start X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_4_start_y', label: 'Flow 4: Start Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_4_end_x', label: 'Flow 4: End X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_4_end_y', label: 'Flow 4: End Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_4_path', label: 'Flow 4: SVG Path (Advanced)', helper: 'Manual SVG path (overrides preset if filled).', selector: { text: { multiline: true } } },
      { name: 'custom_flow_4_color', label: (fields.custom_flow_4_color && fields.custom_flow_4_color.label) || 'Custom Flow 4: Color', helper: (fields.custom_flow_4_color && fields.custom_flow_4_color.helper) || 'Color of the flow.', selector: { color_picker: {} } },
      { name: 'custom_flow_4_threshold', label: (fields.custom_flow_4_threshold && fields.custom_flow_4_threshold.label) || 'Custom Flow 4: Threshold (W)', helper: (fields.custom_flow_4_threshold && fields.custom_flow_4_threshold.helper) || 'Minimum power value (in watts) to activate the flow.', selector: { number: { min: 0, max: 10000, step: 10, mode: 'box', unit_of_measurement: 'W' } } },
      { name: 'custom_flow_4_direction', label: (fields.custom_flow_4_direction && fields.custom_flow_4_direction.label) || 'Custom Flow 4: Direction', helper: (fields.custom_flow_4_direction && fields.custom_flow_4_direction.helper) || 'Flow direction: forward (always positive), reverse (always negative), or auto (based on sensor value sign).', selector: { select: { options: [['forward', 'Forward'], ['reverse', 'Reverse'], ['auto', 'Auto']] } } },
      { name: 'custom_flow_4_offset_x', label: (fields.custom_flow_4_offset_x && fields.custom_flow_4_offset_x.label) || 'Custom Flow 4: Offset X (px)', helper: (fields.custom_flow_4_offset_x && fields.custom_flow_4_offset_x.helper) || 'Horizontal offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_4_offset_y', label: (fields.custom_flow_4_offset_y && fields.custom_flow_4_offset_y.label) || 'Custom Flow 4: Offset Y (px)', helper: (fields.custom_flow_4_offset_y && fields.custom_flow_4_offset_y.helper) || 'Vertical offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },

      { name: 'custom_flow_5_enabled', label: (fields.custom_flow_5_enabled && fields.custom_flow_5_enabled.label) || 'Custom Flow 5: Enabled', helper: (fields.custom_flow_5_enabled && fields.custom_flow_5_enabled.helper) || 'Enable custom flow 5.', selector: { boolean: {} } },
      { name: 'custom_flow_5_sensor', label: (fields.custom_flow_5_sensor && fields.custom_flow_5_sensor.label) || 'Custom Flow 5: Sensor', helper: (fields.custom_flow_5_sensor && fields.custom_flow_5_sensor.helper) || 'Sensor entity that controls this flow (power sensor). Flow direction is based on sensor value sign.', selector: entitySelector },
      { name: 'custom_flow_5_path_preset', label: 'Custom Flow 5: Path Type', helper: 'Choose a preset path shape or Custom to use Start/End coordinates below.', selector: { select: { options: pathPresetOptions } }, default: 'custom' },
      { name: 'custom_flow_5_start_x', label: 'Flow 5: Start X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_5_start_y', label: 'Flow 5: Start Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_5_end_x', label: 'Flow 5: End X', selector: { number: { min: 0, max: 800, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_5_end_y', label: 'Flow 5: End Y', selector: { number: { min: 0, max: 450, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_5_path', label: 'Flow 5: SVG Path (Advanced)', helper: 'Manual SVG path (overrides preset if filled).', selector: { text: { multiline: true } } },
      { name: 'custom_flow_5_color', label: (fields.custom_flow_5_color && fields.custom_flow_5_color.label) || 'Custom Flow 5: Color', helper: (fields.custom_flow_5_color && fields.custom_flow_5_color.helper) || 'Color of the flow.', selector: { color_picker: {} } },
      { name: 'custom_flow_5_threshold', label: (fields.custom_flow_5_threshold && fields.custom_flow_5_threshold.label) || 'Custom Flow 5: Threshold (W)', helper: (fields.custom_flow_5_threshold && fields.custom_flow_5_threshold.helper) || 'Minimum power value (in watts) to activate the flow.', selector: { number: { min: 0, max: 10000, step: 10, mode: 'box', unit_of_measurement: 'W' } } },
      { name: 'custom_flow_5_direction', label: (fields.custom_flow_5_direction && fields.custom_flow_5_direction.label) || 'Custom Flow 5: Direction', helper: (fields.custom_flow_5_direction && fields.custom_flow_5_direction.helper) || 'Flow direction: forward (always positive), reverse (always negative), or auto (based on sensor value sign).', selector: { select: { options: [['forward', 'Forward'], ['reverse', 'Reverse'], ['auto', 'Auto']] } } },
      { name: 'custom_flow_5_offset_x', label: (fields.custom_flow_5_offset_x && fields.custom_flow_5_offset_x.label) || 'Custom Flow 5: Offset X (px)', helper: (fields.custom_flow_5_offset_x && fields.custom_flow_5_offset_x.helper) || 'Horizontal offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'custom_flow_5_offset_y', label: (fields.custom_flow_5_offset_y && fields.custom_flow_5_offset_y.label) || 'Custom Flow 5: Offset Y (px)', helper: (fields.custom_flow_5_offset_y && fields.custom_flow_5_offset_y.helper) || 'Vertical offset for the flow path.', selector: { number: { min: -200, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },

      // Custom Text fields
      { name: 'custom_text_1_enabled', label: `Custom Text 1: Enabled`, selector: { boolean: {} } },
      { name: 'custom_text_1_text', label: `Text 1: Label/Prefix`, selector: { text: {} } },
      { name: 'custom_text_1_sensor', label: `Text 1: Sensor`, selector: entitySelector },
      { name: 'custom_text_1_x', label: `Text 1: X Position`, selector: { number: { min: 0, max: 800, step: 1, mode: 'slider' } } },
      { name: 'custom_text_1_y', label: `Text 1: Y Position`, selector: { number: { min: 0, max: 450, step: 1, mode: 'slider' } } },
      { name: 'custom_text_1_color', label: `Text 1: Color`, selector: { color_picker: {} } },
      { name: 'custom_text_1_size', label: `Text 1: Font Size`, selector: { number: { min: 8, max: 48, step: 1, mode: 'slider' } } },

      { name: 'custom_text_2_enabled', label: `Custom Text 2: Enabled`, selector: { boolean: {} } },
      { name: 'custom_text_2_text', label: `Text 2: Label/Prefix`, selector: { text: {} } },
      { name: 'custom_text_2_sensor', label: `Text 2: Sensor`, selector: entitySelector },
      { name: 'custom_text_2_x', label: `Text 2: X Position`, selector: { number: { min: 0, max: 800, step: 1, mode: 'slider' } } },
      { name: 'custom_text_2_y', label: `Text 2: Y Position`, selector: { number: { min: 0, max: 450, step: 1, mode: 'slider' } } },
      { name: 'custom_text_2_color', label: `Text 2: Color`, selector: { color_picker: {} } },
      { name: 'custom_text_2_size', label: `Text 2: Font Size`, selector: { number: { min: 8, max: 48, step: 1, mode: 'slider' } } },

      { name: 'custom_text_3_enabled', label: `Custom Text 3: Enabled`, selector: { boolean: {} } },
      { name: 'custom_text_3_text', label: `Text 3: Label/Prefix`, selector: { text: {} } },
      { name: 'custom_text_3_sensor', label: `Text 3: Sensor`, selector: entitySelector },
      { name: 'custom_text_3_x', label: `Text 3: X Position`, selector: { number: { min: 0, max: 800, step: 1, mode: 'slider' } } },
      { name: 'custom_text_3_y', label: `Text 3: Y Position`, selector: { number: { min: 0, max: 450, step: 1, mode: 'slider' } } },
      { name: 'custom_text_3_color', label: `Text 3: Color`, selector: { color_picker: {} } },
      { name: 'custom_text_3_size', label: `Text 3: Font Size`, selector: { number: { min: 8, max: 48, step: 1, mode: 'slider' } } },

      { name: 'custom_text_4_enabled', label: `Custom Text 4: Enabled`, selector: { boolean: {} } },
      { name: 'custom_text_4_text', label: `Text 4: Label/Prefix`, selector: { text: {} } },
      { name: 'custom_text_4_sensor', label: `Text 4: Sensor`, selector: entitySelector },
      { name: 'custom_text_4_x', label: `Text 4: X Position`, selector: { number: { min: 0, max: 800, step: 1, mode: 'slider' } } },
      { name: 'custom_text_4_y', label: `Text 4: Y Position`, selector: { number: { min: 0, max: 450, step: 1, mode: 'slider' } } },
      { name: 'custom_text_4_color', label: `Text 4: Color`, selector: { color_picker: {} } },
      { name: 'custom_text_4_size', label: `Text 4: Font Size`, selector: { number: { min: 8, max: 48, step: 1, mode: 'slider' } } },

      { name: 'custom_text_5_enabled', label: `Custom Text 5: Enabled`, selector: { boolean: {} } },
      { name: 'custom_text_5_text', label: `Text 5: Label/Prefix`, selector: { text: {} } },
      { name: 'custom_text_5_sensor', label: `Text 5: Sensor`, selector: entitySelector },
      { name: 'custom_text_5_x', label: `Text 5: X Position`, selector: { number: { min: 0, max: 800, step: 1, mode: 'slider' } } },
      { name: 'custom_text_5_y', label: `Text 5: Y Position`, selector: { number: { min: 0, max: 450, step: 1, mode: 'slider' } } },
      { name: 'custom_text_5_color', label: `Text 5: Color`, selector: { color_picker: {} } },
      { name: 'custom_text_5_size', label: `Text 5: Font Size`, selector: { number: { min: 8, max: 48, step: 1, mode: 'slider' } } },

      // Solar Forecast fields
      { name: 'solar_forecast_enabled', label: (fields.solar_forecast_enabled && fields.solar_forecast_enabled.label) || 'Enable Solar Forecast', helper: (fields.solar_forecast_enabled && fields.solar_forecast_enabled.helper) || '⚠️ PRO FEATURE: Display estimated solar production with sun status (lots/moderate/little sun).', selector: { boolean: {} }, default: false },
      { name: 'sensor_solar_forecast', label: (fields.sensor_solar_forecast && fields.sensor_solar_forecast.label) || 'Solar Forecast Sensor', helper: (fields.sensor_solar_forecast && fields.sensor_solar_forecast.helper) || 'Sensor entity for estimated solar production (in W or kW).', selector: entitySelector },
      { name: 'solar_forecast_max_power', label: (fields.solar_forecast_max_power && fields.solar_forecast_max_power.label) || 'Solar Forecast Max Power (W)', helper: (fields.solar_forecast_max_power && fields.solar_forecast_max_power.helper) || 'Maximum expected power in watts. Used to calculate percentage for sun status (default: 10000W).', selector: { number: { min: 1000, max: 50000, step: 100, mode: 'box', unit_of_measurement: 'W' } }, default: 10000 },
      { name: 'solar_forecast_x', label: (fields.solar_forecast_x && fields.solar_forecast_x.label) || 'Solar Forecast X Position (px)', helper: (fields.solar_forecast_x && fields.solar_forecast_x.helper) || 'Horizontal position of the solar forecast text (in pixels).', selector: { number: { min: 0, max: 800, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 400 },
      { name: 'solar_forecast_y', label: (fields.solar_forecast_y && fields.solar_forecast_y.label) || 'Solar Forecast Y Position (px)', helper: (fields.solar_forecast_y && fields.solar_forecast_y.helper) || 'Vertical position of the solar forecast text (in pixels).', selector: { number: { min: 0, max: 450, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 350 },
      { name: 'solar_forecast_color', label: (fields.solar_forecast_color && fields.solar_forecast_color.label) || 'Solar Forecast Color', helper: (fields.solar_forecast_color && fields.solar_forecast_color.helper) || 'Color for the solar forecast text (default: #00FFFF).', selector: { color_picker: {} }, default: '#00FFFF' },
      { name: 'solar_forecast_size', label: (fields.solar_forecast_size && fields.solar_forecast_size.label) || 'Solar Forecast Font Size (px)', helper: (fields.solar_forecast_size && fields.solar_forecast_size.helper) || 'Font size for the solar forecast text (default: 16px).', selector: { number: { min: 8, max: 48, step: 1, mode: 'slider', unit_of_measurement: 'px' } }, default: 16 },

      // Overlay Image Pro fields (5 images)
      { name: 'overlay_image_pro_1', label: (fields.overlay_image_pro_1 && fields.overlay_image_pro_1.label) || 'Overlay Image Pro 1', helper: (fields.overlay_image_pro_1 && fields.overlay_image_pro_1.helper) || 'Path to overlay image pro 1 (e.g., /local/community/lumina-energy-card/overlay_pro_1.png).', selector: { text: { mode: 'blur' } } },
      { name: 'overlay_image_pro_2', label: (fields.overlay_image_pro_2 && fields.overlay_image_pro_2.label) || 'Overlay Image Pro 2', helper: (fields.overlay_image_pro_2 && fields.overlay_image_pro_2.helper) || 'Path to overlay image pro 2 (e.g., /local/community/lumina-energy-card/overlay_pro_2.png).', selector: { text: { mode: 'blur' } } },
      { name: 'overlay_image_pro_3', label: (fields.overlay_image_pro_3 && fields.overlay_image_pro_3.label) || 'Overlay Image Pro 3', helper: (fields.overlay_image_pro_3 && fields.overlay_image_pro_3.helper) || 'Path to overlay image pro 3 (e.g., /local/community/lumina-energy-card/overlay_pro_3.png).', selector: { text: { mode: 'blur' } } },
      { name: 'overlay_image_pro_4', label: (fields.overlay_image_pro_4 && fields.overlay_image_pro_4.label) || 'Overlay Image Pro 4', helper: (fields.overlay_image_pro_4 && fields.overlay_image_pro_4.helper) || 'Path to overlay image pro 4 (e.g., /local/community/lumina-energy-card/overlay_pro_4.png).', selector: { text: { mode: 'blur' } } },
      { name: 'overlay_image_pro_5', label: (fields.overlay_image_pro_5 && fields.overlay_image_pro_5.label) || 'Overlay Image Pro 5', helper: (fields.overlay_image_pro_5 && fields.overlay_image_pro_5.helper) || 'Path to overlay image pro 5 (e.g., /local/community/lumina-energy-card/overlay_pro_5.png).', selector: { text: { mode: 'blur' } } }
    ])
  }
}

_createSectionDefs(localeStrings, schemaDefs) {
    const sections = localeStrings.sections;
    return [
      { id: 'language', title: sections.language.title, helper: sections.language.helper, schema: schemaDefs.language, defaultOpen: true },
      { id: 'installation_type', title: sections.installation_type.title, helper: sections.installation_type.helper, renderContent: () => this._createInstallationTypeSection(), defaultOpen: true },
      { id: 'array1', title: sections.array1.title, helper: sections.array1.helper, schema: schemaDefs.array1, defaultOpen: false },
      { id: 'array2', title: sections.array2.title, helper: sections.array2.helper, renderContent: () => {
        const wrapper = document.createElement('div');
        wrapper.appendChild(this._createForm(schemaDefs.array2));
        return wrapper;
      }, defaultOpen: false },
      { id: 'battery', title: sections.battery.title, helper: sections.battery.helper, schema: schemaDefs.battery, defaultOpen: false },
      { id: 'grid', title: sections.grid.title, helper: sections.grid.helper, schema: schemaDefs.grid, defaultOpen: false },
      { id: 'car', title: sections.car.title, helper: sections.car.helper, schema: schemaDefs.car, defaultOpen: false },
      { id: 'heatPump', title: sections.heatPump.title, helper: sections.heatPump.helper, schema: schemaDefs.heatPump, defaultOpen: false },
      { id: 'house_management', title: (sections.house_management && sections.house_management.title) || 'House Management', helper: (sections.house_management && sections.house_management.helper) || 'Assign entities to Home icon buttons (cameras, lights, temperature, security, humidity). Up to 6 per icon. Click camera icon to open stream popup.', schema: schemaDefs.house_management, defaultOpen: false },
      { id: 'pvPopup', title: sections.pvPopup.title, helper: sections.pvPopup.helper, schema: schemaDefs.pvPopup, defaultOpen: false },
      { id: 'batteryPopup', title: sections.batteryPopup.title, helper: sections.batteryPopup.helper, schema: schemaDefs.batteryPopup, defaultOpen: false },
      { id: 'gridPopup', title: sections.gridPopup.title, helper: sections.gridPopup.helper, schema: schemaDefs.gridPopup, defaultOpen: false },
      { id: 'inverterPopup', title: sections.inverterPopup.title, helper: sections.inverterPopup.helper, schema: schemaDefs.inverterPopup, defaultOpen: false },
      { id: 'housePopup', title: sections.housePopup.title, helper: sections.housePopup.helper, schema: schemaDefs.housePopup, defaultOpen: false },
      { id: 'general', title: sections.general.title, helper: sections.general.helper, schema: schemaDefs.general, defaultOpen: false },
      { id: 'flow_colors', title: sections.flow_colors.title, helper: sections.flow_colors.helper, schema: schemaDefs.flow_colors, defaultOpen: false },
      { id: 'animation_styles', title: (sections.animation_styles && sections.animation_styles.title) || 'Animation Styles', helper: (sections.animation_styles && sections.animation_styles.helper) || 'Flow animation style. Default: shimmer.', schema: schemaDefs.animation_styles, defaultOpen: false },
      { id: 'flow_path_custom', title: sections.flow_path_custom.title, helper: sections.flow_path_custom.helper, schema: schemaDefs.flow_path_custom, defaultOpen: false },
      { id: 'layout', title: sections.layout.title, helper: sections.layout.helper, schema: schemaDefs.layout, defaultOpen: false },
      { id: 'socBar', title: (sections.socBar && sections.socBar.title) || 'SOC Bar', helper: (sections.socBar && sections.socBar.helper) || '6-segment bar on battery. Position, opacity, glow, colors.', schema: schemaDefs.socBar, defaultOpen: false },
      { id: 'gridBox', title: (sections.gridBox && sections.gridBox.title) || 'Grid Box', helper: (sections.gridBox && sections.gridBox.helper) || 'Top-right box. Import/Export + daily. Position and size.', schema: schemaDefs.gridBox, defaultOpen: false },
      { id: 'pvBox', title: (sections.pvBox && sections.pvBox.title) || 'PV Box', helper: (sections.pvBox && sections.pvBox.helper) || 'Top-left box. PV Total (sum) + Daily production. Position and size.', schema: schemaDefs.pvBox, defaultOpen: false },
      { id: 'about', title: sections.about.title, helper: sections.about.helper, schema: null, defaultOpen: false, renderContent: () => this._createAboutContent() },
      { id: 'lumina_pro', title: sections.lumina_pro.title, helper: sections.lumina_pro.helper, schema: schemaDefs.lumina_pro, defaultOpen: false }
    ];
  }

  _configWithDefaults() {
    return { ...this._defaults, ...this._config };
  }

  setConfig(config) {
    if (this._config && JSON.stringify(config) === JSON.stringify(this._config)) {
      return;
    }
    this._config = { ...config };

    // Se l'editor è già disegnato, aggiorna solo i dati senza render() che distrugge gli input.
    const forms = this.shadowRoot.querySelectorAll('ha-form');
    if (forms && forms.length > 0) {
      const data = this._configWithDefaults();
      forms.forEach((form) => {
        if (form) form.data = data;
      });
      return;
    }

    this.render();
  }

  get value() {
    return this._config;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config || this._rendered) {
      return;
    }
    this.render();
  }

  configChanged(newConfig) {
    const raw = newConfig || this._config;
    if (!raw) return;

    // Shallow copy so card-mod / layout-card can add properties (avoids "object is not extensible")
    const config = { ...raw };

    const event = new CustomEvent('config-changed', {
      detail: { config },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);

    const windowEvent = new CustomEvent('config-changed', {
      detail: { config },
      bubbles: true,
      composed: true,
    });
    window.dispatchEvent(windowEvent);

    try {
      if (window.parent && window.parent !== window) {
        window.parent.dispatchEvent(new CustomEvent('config-changed', {
          detail: { config },
          bubbles: true,
          composed: true,
        }));
      }
    } catch (e) {
      // Silent error handling
    }

    let card = document.querySelector('lumina-energy-card');
    if (!card && window.parent && window.parent.document) {
      card = window.parent.document.querySelector('lumina-energy-card');
    }
    if (card) {
      card.setConfig(config);
    }
  }

  _debouncedConfigChanged(newConfig, immediate = false) {
    this._config = newConfig;
    if (this._configChangeTimer) {
      clearTimeout(this._configChangeTimer);
      this._configChangeTimer = null;
    }
    if (immediate) {
      this.configChanged(newConfig);
      return;
    }
    const delay = 800;
    this._configChangeTimer = setTimeout(() => {
      this.configChanged(this._config);
      this._configChangeTimer = null;
    }, delay);
  }

  _createSection(sectionDef) {
    const { id, title, helper, schema, defaultOpen, renderContent } = sectionDef;
    const section = document.createElement('details');
    section.className = 'section';
    const storedState = id && Object.prototype.hasOwnProperty.call(this._sectionOpenState, id)
      ? this._sectionOpenState[id]
      : undefined;
    section.open = storedState !== undefined ? storedState : Boolean(defaultOpen);
    if (id) {
      section.dataset.sectionId = id;
    }

    const summary = document.createElement('summary');
    summary.className = 'section-summary';
    summary.textContent = title;
    if (id === 'overlay_image') {
      summary.style.color = '#ff4444';
      summary.style.fontWeight = 'bold';
    }
    section.appendChild(summary);

    const content = document.createElement('div');
    content.className = 'section-content';

    if (helper) {
      const helperEl = document.createElement('div');
      helperEl.className = 'section-helper';
      helperEl.textContent = helper;
      if (id === 'overlay_image') {
        helperEl.style.color = '#ff4444';
        helperEl.style.fontWeight = 'bold';
      }
      content.appendChild(helperEl);
    }

    if (id === 'overlay_image' || id === 'lumina_pro') {
      content.appendChild(this._createPayPalButton());
    }

    if (Array.isArray(schema) && schema.length > 0) {
      // Filter out sensor_home_load_secondary when installation type is '3'
      let filteredSchema = schema;
      const installationType = this._config && this._config.installation_type ? this._config.installation_type : '1';
      if (installationType === '3' && id === 'grid') {
        filteredSchema = schema.filter(field => field.name !== 'sensor_home_load_secondary');
      }

      if (id === 'lumina_pro') {
        const cfg = this._configWithDefaults();
        const pw = cfg.pro_password;
        let ok = false;
        if (pw && typeof pw === 'string' && pw.trim()) {
          const h = LUMINA_SHA256(pw.trim());
          if (LUMINA_AUTH_LIST && LUMINA_AUTH_LIST.includes(h)) ok = true;
        }
        if (!ok) filteredSchema = schema.filter((f) => f.name === 'pro_password');
      }

      content.appendChild(this._createForm(filteredSchema, id === 'overlay_image'));
    } else if (typeof renderContent === 'function') {
      const custom = renderContent();
      if (custom) {
        content.appendChild(custom);
      }
    }
    section.appendChild(content);
    section.addEventListener('toggle', () => {
      if (id) {
        this._sectionOpenState = { ...this._sectionOpenState, [id]: section.open };
      }
    });
    return section;
  }

  _getBackgroundPaths(installationType, imageStyle) {
    const base = '/local/community/lumina-energy-card/';
    const real = imageStyle === 'real';
    const sfx = real ? '_real.png' : '.png';
    let bgName;
    if (installationType === '1') bgName = real ? 'lumina_background' + sfx : 'lumina_background1' + sfx;
    else if (installationType === '2') bgName = 'lumina_background_nocar' + sfx;
    else bgName = 'lumina_background_nosolarnocar' + sfx;
    const hpName = 'lumina-energy-card-hp' + sfx;
    return {
      background_image: base + bgName,
      background_image_heat_pump: base + hpName
    };
  }

  _createInstallationTypeSection() {
    const container = document.createElement('div');
    container.className = 'installation-type-content';
    
    const config = this._configWithDefaults();
    const currentType = config.installation_type || '1';
    const currentStyle = (config.image_style === 'real' ? 'real' : 'holographic');
    const lang = (config.language || 'en').toLowerCase();
    
    const styleLabels = {
      en: ['Holographic image', 'Real image'],
      it: ['Immagine olografica', 'Immagine reale'],
      de: ['Holografisches Bild', 'Reales Bild'],
      fr: ['Image holographique', 'Image réelle'],
      nl: ['Holografische afbeelding', 'Echte afbeelding']
    };
    const typeLabels = {
      en: ['1. PV Installation + Car', '2. PV Installation without Car', '3. No PV, no Car'],
      it: ['1. Impianto fotovoltaico + Auto', '2. Impianto fotovoltaico senza Auto', '3. No fotovoltaico, no Auto'],
      de: ['1. PV-Anlage + Auto', '2. PV-Anlage ohne Auto', '3. Keine PV, kein Auto'],
      fr: ['1. Installation PV + Voiture', '2. Installation PV sans voiture', '3. Pas de PV, pas de voiture'],
      nl: ['1. PV-installatie + Auto', '2. PV-installatie zonder auto', '3. Geen PV, geen auto']
    };
    const sl = styleLabels[lang] || styleLabels.en;
    const tl = typeLabels[lang] || typeLabels.en;
    
    const styleOptions = [
      { value: 'holographic', label: sl[0] },
      { value: 'real', label: sl[1] }
    ];
    const typeOptions = [
      { value: '1', label: tl[0] },
      { value: '2', label: tl[1] },
      { value: '3', label: tl[2] }
    ];
    
    const addRadioRow = (opts, name, current, onChange) => {
      opts.forEach((opt) => {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.marginBottom = '12px';
        label.style.cursor = 'pointer';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = name;
        radio.value = opt.value;
        radio.checked = current === opt.value;
        radio.style.marginRight = '8px';
        radio.addEventListener('change', () => { if (radio.checked) onChange(opt.value); });
        const text = document.createElement('span');
        text.textContent = opt.label;
        label.appendChild(radio);
        label.appendChild(text);
        container.appendChild(label);
      });
    };
    
    addRadioRow(styleOptions, 'image_style', currentStyle, (v) => this._handleImageStyleChange(v));
    
    const sep = document.createElement('div');
    sep.style.marginTop = '16px';
    sep.style.marginBottom = '8px';
    container.appendChild(sep);
    
    addRadioRow(typeOptions, 'installation_type', currentType, (v) => this._handleInstallationTypeChange(v));
    
    return container;
  }

  _handleImageStyleChange(style) {
    const config = this._configWithDefaults();
    config.image_style = style;
    const type = config.installation_type || '1';
    const paths = this._getBackgroundPaths(type, style);
    config.background_image = paths.background_image;
    config.background_image_heat_pump = paths.background_image_heat_pump;
    this._config = { ...config };
    this._debouncedConfigChanged(config, true);
    this._rendered = false;
    this.render();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this._updateSectionVisibility(type));
    });
  }

  _handleInstallationTypeChange(type) {
    const config = this._configWithDefaults();
    config.installation_type = type;
    const style = config.image_style === 'real' ? 'real' : 'holographic';
    const paths = this._getBackgroundPaths(type, style);
    config.background_image = paths.background_image;
    config.background_image_heat_pump = paths.background_image_heat_pump;
    
    // Update show_car_soc based on type
    if (type === '2' || type === '3') {
      config.show_car_soc = false;
      config.show_car2 = false;
    } else {
      // Type 1: keep current car settings or default
      if (config.show_car_soc === undefined) {
        config.show_car_soc = false;
      }
    }
    
    // Update config and notify the main card
    this._config = { ...config };
    this._debouncedConfigChanged(config, true);
    this._rendered = false;
    this.render();
    // Use requestAnimationFrame to ensure DOM is ready before updating visibility
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this._updateSectionVisibility(type);
      });
    });
  }

  _updateSectionVisibility(type) {
    // Hide/show sections based on installation type
    const sections = this.shadowRoot.querySelectorAll('details.section');
    sections.forEach((section) => {
      const sectionId = section.dataset.sectionId;
      if (!sectionId) return;
      
      if (type === '3') {
        // Only show: general, grid (for sensor_home_load, sensor_house_temperature), housePopup
        // Hide all sections related to PV and battery
        if (['array1', 'array2', 'battery', 'socBar', 'gridBox', 'pvBox', 'car', 'pvPopup', 'batteryPopup', 'inverterPopup', 'flow_path', 'flow_path_custom'].includes(sectionId)) {
          section.style.display = 'none';
        } else {
          section.style.display = '';
          // Hide PV and battery related fields within visible sections
          const pvFields = section.querySelectorAll('[name*="pv"], [name*="bat"], [name*="battery"], [name*="solar"]');
          pvFields.forEach(field => {
            const row = field.closest('.form-row, .form-element, ha-formfield');
            if (row) row.style.display = 'none';
          });
          // Hide sensor_home_load_secondary (Home Load Inverter 2) when type === '3'
          // Try multiple selectors to find the field - including searching in shadow DOM
          const selectors = [
            '[name="sensor_home_load_secondary"]',
            '[name*="home_load_secondary"]',
            'ha-entity-picker[name="sensor_home_load_secondary"]',
            'ha-textfield[name="sensor_home_load_secondary"]',
            'input[name="sensor_home_load_secondary"]'
          ];
          let homeLoadSecondaryField = null;
          for (const selector of selectors) {
            homeLoadSecondaryField = section.querySelector(selector);
            if (!homeLoadSecondaryField) {
              // Try to find in shadow DOM
              const allElements = section.querySelectorAll('*');
              for (const el of allElements) {
                if (el.shadowRoot) {
                  homeLoadSecondaryField = el.shadowRoot.querySelector(selector);
                  if (homeLoadSecondaryField) break;
                }
              }
            }
            if (homeLoadSecondaryField) break;
          }
          // Also try searching by label text as fallback
          if (!homeLoadSecondaryField) {
            const labels = section.querySelectorAll('label, .label, ha-label');
            for (const label of labels) {
              const labelText = (label.textContent || '').toLowerCase();
              if (labelText.includes('inverter 2') && (labelText.includes('load') || labelText.includes('carico'))) {
                const field = label.parentElement || label.nextElementSibling;
                if (field) {
                  homeLoadSecondaryField = field.querySelector('ha-entity-picker, ha-textfield, input') || field;
                  if (homeLoadSecondaryField) break;
                }
              }
            }
          }
          if (homeLoadSecondaryField) {
            // Try to find parent container
            const containers = [
              '.form-row',
              '.form-element',
              'ha-formfield',
              'tr',
              'mwc-formfield',
              '.form-row-content',
              'div[class*="form"]'
            ];
            let row = null;
            for (const containerSelector of containers) {
              row = homeLoadSecondaryField.closest(containerSelector);
              if (row) break;
            }
            if (row) {
              row.style.display = 'none';
              row.setAttribute('data-hidden-for-type3', 'true');
            } else {
              // Fallback: hide the field itself and its parent
              homeLoadSecondaryField.style.display = 'none';
              homeLoadSecondaryField.setAttribute('data-hidden-for-type3', 'true');
              if (homeLoadSecondaryField.parentElement) {
                homeLoadSecondaryField.parentElement.style.display = 'none';
                homeLoadSecondaryField.parentElement.setAttribute('data-hidden-for-type3', 'true');
              }
            }
          }
        }
      } else if (type === '2') {
        // Hide car section only
        if (sectionId === 'car') {
          section.style.display = 'none';
        } else {
          section.style.display = '';
          // Show sensor_home_load_secondary for type 2
          const homeLoadSecondaryField = section.querySelector('[name="sensor_home_load_secondary"]');
          if (homeLoadSecondaryField) {
            const row = homeLoadSecondaryField.closest('.form-row, .form-element, ha-formfield');
            if (row) row.style.display = '';
          }
        }
      } else {
        // Type 1: show all
        section.style.display = '';
        // Show sensor_home_load_secondary for type 1
        const homeLoadSecondaryField = section.querySelector('[name="sensor_home_load_secondary"]');
        if (homeLoadSecondaryField) {
          const row = homeLoadSecondaryField.closest('.form-row, .form-element, ha-formfield');
          if (row) row.style.display = '';
        }
      }
    });
  }

  _createAboutContent() {
    const container = document.createElement('div');
    container.className = 'about-content';

    const title = document.createElement('div');
    title.className = 'about-title';
    title.textContent = 'Lumina Energy Card';
    container.appendChild(title);

    const version = document.createElement('div');
    version.className = 'about-version';
    version.textContent = `Version ${typeof LuminaEnergyCard !== 'undefined' && LuminaEnergyCard.version ? LuminaEnergyCard.version : 'Unknown'}`;
    container.appendChild(version);

    const links = document.createElement('div');
    links.className = 'about-links';

    const repoLabel = document.createElement('span');
    repoLabel.className = 'about-label';
    repoLabel.textContent = 'Repository:';
    links.appendChild(repoLabel);

    const repoLink = document.createElement('a');
    repoLink.href = 'https://github.com/Giorgio866/lumina-energy-card';
    repoLink.target = '_blank';
    repoLink.rel = 'noopener noreferrer';
    repoLink.textContent = 'Repository';
    links.appendChild(repoLink);

    const devs = document.createElement('div');
    devs.className = 'about-developers';

    const devLabel = document.createElement('span');
    devLabel.className = 'about-label';
    devLabel.textContent = 'Developers:';
    devs.appendChild(devLabel);

    const saliernLink = document.createElement('a');
    saliernLink.href = 'https://github.com/Giorgio866';
    saliernLink.target = '_blank';
    saliernLink.rel = 'noopener noreferrer';
    saliernLink.textContent = 'Saliern Giorgio';

    devs.appendChild(saliernLink);

    container.appendChild(links);
    container.appendChild(devs);

    return container;
  }

  _createPayPalButton() {
    const localeStrings = this._getLocaleStrings();
    const config = this._configWithDefaults();
    const wrapper = document.createElement('div');
    wrapper.className = 'paypal-button-wrapper';

    let isAuthorized = false;
    const pw = config.pro_password;
    if (pw && typeof pw === 'string' && pw.trim()) {
      const h = LUMINA_SHA256(pw.trim());
      if (LUMINA_AUTH_LIST && LUMINA_AUTH_LIST.includes(h)) isAuthorized = true;
    }
    if (isAuthorized) wrapper.classList.add('authorized');

    const paypalUrl = 'https://paypal.me/giorgiosalierno';
    
    const link = document.createElement('a');
    link.href = paypalUrl;
    link.target = '_blank';
    link.className = 'paypal-link';
    
    // PayPal SVG Icon
    link.innerHTML = `
      <svg class="paypal-icon" viewBox="0 0 24 24">
        <path d="M20.067 8.478c.492.247.722.76.514 1.148l-1.334 2.484c-.208.388-.748.544-1.205.348l-4.507-1.93-1.334 2.484 4.507 1.93c.457.196.687.71.479 1.098l-1.334 2.484c-.208.388-.748.544-1.205.348l-4.507-1.93-1.334 2.484 4.507 1.93c.457.196.687.71.479 1.098l-1.334 2.484c-.208.388-.748.544-1.205.348l-4.507-1.93-2.185 4.067a.71.71 0 0 1-.94.272.648.648 0 0 1-.295-.875l11.066-20.6a.71.71 0 0 1 .94-.272.648.648 0 0 1 .295.875l-1.334 2.484z"/>
        <path d="M12.443 14.153l1.334-2.484 4.507 1.93c.457.196.687.71.479 1.098l-1.334 2.484c-.208.388-.748.544-1.205.348l-4.507-1.93zM10.109 18.5l1.334-2.484 4.507 1.93c.457.196.687.71.479 1.098l-1.334 2.484c-.208.388-.748.544-1.205.348l-4.507-1.93zM7.775 22.847l1.334-2.484 4.507 1.93c.457.196.687.71.479 1.098l-1.334 2.484c-.208.388-.748.544-1.205.348l-4.507-1.93z"/>
      </svg>
      <span>${isAuthorized ? 'PRO Active - Support Project' : localeStrings.fields.paypal_button}</span>
    `;
    
    const note = document.createElement('div');
    note.className = 'paypal-instruction-note';
    note.textContent = localeStrings.fields.paypal_note;

    wrapper.appendChild(link);
    wrapper.appendChild(note);
    
    return wrapper;
  }

  _createForm(schema, isPro = false) {
    const hasColorFields = schema.some(field => field.selector && field.selector.color_picker);
    // Force custom rendering when language is present so we can use a native dropdown
    const hasLanguageField = schema.some(field => field.name === 'language');
    
    if (hasColorFields || hasLanguageField) {
      return this._createCustomForm(schema);
    }
    
    const form = document.createElement('ha-form');
    form.hass = this._hass;
    form.data = this._configWithDefaults();
    form.schema = schema;
    if (isPro) {
      form.style.setProperty('--secondary-text-color', '#ff4444');
      form.style.setProperty('--primary-text-color', '#ff4444');
      form.style.color = '#ff4444';
    }
    form.computeLabel = (field) => field.label || field.name;
    form.computeHelper = (field) => field.helper;
    form.addEventListener('value-changed', (ev) => {
      if (ev.target !== form) {
        return;
      }
      this._onFormValueChanged(ev, schema);
    });
    // Apply config immediately when any inner input loses focus
    form.addEventListener('focusout', (ev) => {
      // Ensure the event originated from inside this form
      if (!form.contains(ev.target)) return;
      this._debouncedConfigChanged(this._config, true);
    });
    return form;
  }

  _createCustomForm(schema) {
    const container = document.createElement('div');
    container.className = 'custom-form';
    const data = this._configWithDefaults();

    schema.forEach(field => {
      if (field.selector && field.selector.color_picker) {
        container.appendChild(this._createColorPickerField(field, data[field.name] || field.default || ''));
      } else {
        container.appendChild(this._createStandardField(field, data[field.name] || field.default));
      }
    });

    return container;
  }

  _createColorPickerField(field, value) {
    const wrapper = document.createElement('div');
    wrapper.className = 'color-field-wrapper';

    const label = document.createElement('label');
    label.className = 'color-field-label';
    label.textContent = field.label || field.name;
    wrapper.appendChild(label);

    if (field.helper) {
      const helper = document.createElement('div');
      helper.className = 'color-field-helper';
      helper.textContent = field.helper;
      wrapper.appendChild(helper);
    }

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'color-input-wrapper';

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'color-text-input';
    textInput.value = value || '';
    textInput.placeholder = '#RRGGBB or CSS color';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'color-picker-input';
    colorInput.value = this._normalizeColorForPicker(value);

    textInput.addEventListener('input', (e) => {
      const color = e.target.value;
      const normalized = this._normalizeColorForPicker(color);
      if (normalized) {
        colorInput.value = normalized;
      }
      this._updateFieldValue(field.name, color);
    });

    // Apply config immediately when color inputs lose focus
    textInput.addEventListener('blur', () => {
      this._debouncedConfigChanged(this._config, true);
    });

    colorInput.addEventListener('input', (e) => {
      textInput.value = e.target.value;
      this._updateFieldValue(field.name, e.target.value);
    });

    colorInput.addEventListener('blur', () => {
      this._debouncedConfigChanged(this._config, true);
    });

    inputWrapper.appendChild(colorInput);
    inputWrapper.appendChild(textInput);
    wrapper.appendChild(inputWrapper);

    return wrapper;
  }

  _createStandardField(field, value) {
    const wrapper = document.createElement('div');
    wrapper.className = 'standard-field-wrapper';

    const label = document.createElement('label');
    label.textContent = field.label || field.name;
    wrapper.appendChild(label);

    if (field.helper) {
      const helper = document.createElement('div');
      helper.className = 'field-helper';
      helper.textContent = field.helper;
      wrapper.appendChild(helper);
    }

    const form = document.createElement('ha-form');
    form.hass = this._hass;
    form.data = { [field.name]: value };
    form.schema = [field];
    form.computeLabel = () => '';
    form.computeHelper = () => '';
    form.addEventListener('value-changed', (ev) => {
      if (ev.target !== form) {
        return;
      }
      const newValue = ev.detail.value[field.name];
      this._updateFieldValue(field.name, newValue);
    });
    // When an inner input loses focus, apply the config immediately
    form.addEventListener('focusout', (ev) => {
      if (!form.contains(ev.target)) return;
      this._debouncedConfigChanged(this._config, true);
    });

    // Render the language field as a native dropdown to support very long lists
    if (field.name === 'language') {
      const select = document.createElement('select');
      select.style.padding = '8px';
      select.style.border = '1px solid var(--divider-color)';
      select.style.borderRadius = '4px';
      select.style.background = 'var(--card-background-color)';
      select.style.color = 'var(--primary-text-color)';
      const localeStrings = this._getLocaleStrings();
      const opts = this._getAvailableLanguageOptions(localeStrings);
      opts.forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label || o.value;
        select.appendChild(opt);
      });
      select.value = value || (this._defaults && this._defaults.language) || 'en';
      select.addEventListener('change', (e) => {
        const newLanguage = e.target.value;
        this._updateFieldValue(field.name, newLanguage);
        // Update config immediately so _currentLanguage() returns the new value
        if (!this._config) this._config = {};
        this._config.language = newLanguage;
        // Force re-render when language changes to update all labels
        this._rendered = false;
        // Use requestAnimationFrame to ensure config is updated before render
        requestAnimationFrame(() => {
          this.render();
        });
        this._debouncedConfigChanged(this._config, true);
      });
      select.addEventListener('blur', () => {
        this._debouncedConfigChanged(this._config, true);
      });
      wrapper.appendChild(select);
    } else {
      wrapper.appendChild(form);
    }
    return wrapper;
  }


  _normalizeColorForPicker(color) {
    if (!color) return '#000000';
    if (color.startsWith('#')) {
      const hex = color.length === 7 ? color : '#000000';
      return hex;
    }
    const tempDiv = document.createElement('div');
    tempDiv.style.color = color;
    document.body.appendChild(tempDiv);
    const computed = window.getComputedStyle(tempDiv).color;
    document.body.removeChild(tempDiv);
    
    const match = computed.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (match) {
      const r = parseInt(match[1]).toString(16).padStart(2, '0');
      const g = parseInt(match[2]).toString(16).padStart(2, '0');
      const b = parseInt(match[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
    return '#000000';
  }

  _updateFieldValue(fieldName, value, immediate = false) {
    if (!this._config) {
      this._config = {};
    }
    const newConfig = { ...this._config, [fieldName]: value };
    this._config = newConfig;
    this._debouncedConfigChanged(newConfig, immediate);
  }

  _onFormValueChanged(ev, schema) {
    ev.stopPropagation();
    if (!this._config) {
      return;
    }
    const value = ev.detail ? ev.detail.value : undefined;
    if (!value || typeof value !== 'object') {
      return;
    }

    const prevDisplayUnit = (this._config && this._config.display_unit ? this._config.display_unit : this._defaults.display_unit || 'kW').toUpperCase();
    const newConfig = { ...this._config };
    schema.forEach((field) => {
      if (!field.name) {
        return;
      }
      const fieldValue = value[field.name];
      const defaultVal = field.default !== undefined ? field.default : this._defaults[field.name];
      if (
        fieldValue === '' ||
        fieldValue === null ||
        fieldValue === undefined ||
        (defaultVal !== undefined && fieldValue === defaultVal)
      ) {
        delete newConfig[field.name];
      } else {
        newConfig[field.name] = fieldValue;
      }
    });

    const nextDisplayUnit = (newConfig.display_unit || prevDisplayUnit).toUpperCase();
    if (nextDisplayUnit !== prevDisplayUnit) {
      this._convertThresholdValues(newConfig, prevDisplayUnit, nextDisplayUnit);
    }

    const proPassword = newConfig.pro_password;
    const overlayEnabledChanged = (this._config.overlay_image_enabled !== newConfig.overlay_image_enabled);
    
    if (proPassword && typeof proPassword === 'string' && proPassword.trim()) {
      const trimmed = proPassword.trim();
      const hashHex = LUMINA_SHA256(trimmed);
      
      // Use remote list for verification
      let isValid = false;
      if (LUMINA_AUTH_LIST === null) {
        // If list is still loading, try to refresh and re-render
        LUMINA_REFRESH_AUTH(() => {
          this._rendered = false;
          this.render();
        });
      } else {
        isValid = LUMINA_AUTH_LIST.includes(hashHex);
        // Force re-render if authorization state just changed to update PayPal button size
        const wasAuthorized = this._isAuthorized;
        this._isAuthorized = isValid;
        if (wasAuthorized !== isValid) {
          this._rendered = false;
          // Defer render slightly to ensure config is updated
          setTimeout(() => this.render(), 10);
        }
      }
      
      if (!isValid && LUMINA_AUTH_LIST !== null) {
        // Disable overlay if password is not valid (and list is loaded)
        if (newConfig.overlay_image_enabled) {
          newConfig.overlay_image_enabled = false;
          this._config = newConfig;
          this._debouncedConfigChanged(newConfig, true);
          this._rendered = false;
          this.render();
        }
      }
    } else {
      // No password or empty, disable overlay
      if (newConfig.overlay_image_enabled) {
        newConfig.overlay_image_enabled = false;
        this._config = newConfig;
        this._debouncedConfigChanged(newConfig, true);
        this._rendered = false;
        this.render();
      }
    }

    this._config = newConfig;
    this._debouncedConfigChanged(newConfig, nextDisplayUnit !== prevDisplayUnit);
    // Only re-render the editor when the display unit changed because that
    // affects selector definitions (W vs kW). Re-rendering on every input
    // causes the active input to be recreated and loses focus while typing.
    if (nextDisplayUnit !== prevDisplayUnit) {
      this._rendered = false;
      this.render();
    }
  }

  _convertThresholdValues(config, fromUnit, toUnit) {
    const normalizeUnit = (unit) => (unit || 'kW').toUpperCase();
    const sourceUnit = normalizeUnit(fromUnit);
    const targetUnit = normalizeUnit(toUnit);
    if (sourceUnit === targetUnit) {
      return;
    }

    let factor = null;
    if (sourceUnit === 'W' && targetUnit === 'KW') {
      factor = 1 / 1000;
    } else if (sourceUnit === 'KW' && targetUnit === 'W') {
      factor = 1000;
    }
    if (factor === null) {
      return;
    }

    const fieldsToConvert = ['load_threshold_warning', 'load_threshold_critical', 'grid_threshold_warning', 'grid_threshold_critical'];
    fieldsToConvert.forEach((name) => {
      const hasOwn = Object.prototype.hasOwnProperty.call(config, name);
      const currentValue = hasOwn ? config[name] : (this._config ? this._config[name] : undefined);
      if (currentValue === undefined || currentValue === null || currentValue === '') {
        if (hasOwn) {
          config[name] = currentValue;
        }
        return;
      }
      const numeric = Number(currentValue);
      if (!Number.isFinite(numeric)) {
        return;
      }
      const converted = numeric * factor;
      const precision = factor < 1 ? 3 : 0;
      const rounded = precision > 0 ? Number(converted.toFixed(precision)) : Math.round(converted);
      config[name] = rounded;
    });
  }

  _buildConfigContent() {
    const container = document.createElement('div');
    container.className = 'card-config';

    const localeStrings = this._getLocaleStrings();
    const optionDefs = this._createOptionDefs(localeStrings);
    const schemaDefs = this._createSchemaDefs(localeStrings, optionDefs);
    const sections = this._createSectionDefs(localeStrings, schemaDefs);

    sections.forEach((section) => {
      container.appendChild(this._createSection(section));
    });

    return container;
  }

  render() {
    if (!this._hass || !this._config) {
      return;
    }

    this.shadowRoot.innerHTML = '';

    // Update section visibility based on installation type
    const config = this._configWithDefaults();
    const installationType = config.installation_type || '1';
    
    const style = document.createElement('style');
    style.textContent = `
      .card-config {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
      }
      details.section {
        border: 1px solid var(--divider-color);
        border-radius: 10px;
        background: var(--ha-card-background, var(--card-background-color, #fff));
        overflow: hidden;
      }
      details.section:not(:first-of-type) {
        margin-top: 4px;
      }
      .section-summary {
        font-weight: bold;
        font-size: 1.05em;
        padding: 12px 16px;
        color: var(--primary-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        list-style: none;
      }
      .section-summary::-webkit-details-marker {
        display: none;
      }
      .section-summary::after {
        content: '>';
        font-size: 0.9em;
        transform: rotate(90deg);
        transition: transform 0.2s ease;
      }
      details.section[open] .section-summary::after {
        transform: rotate(270deg);
      }
      .section-content {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 0 16px 16px;
      }
      .section-helper {
        font-size: 0.9em;
        color: var(--secondary-text-color);
      }
      ha-form {
        width: 100%;
      }
      .custom-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .color-field-wrapper,
      .standard-field-wrapper {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .color-field-label {
        font-weight: 500;
        font-size: 0.95em;
        color: var(--primary-text-color);
      }
      .color-field-helper,
      .field-helper {
        font-size: 0.85em;
        color: var(--secondary-text-color);
      }
      .color-input-wrapper {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .color-picker-input {
        width: 48px;
        height: 32px;
        border: 1px solid var(--divider-color);
        border-radius: 4px;
        cursor: pointer;
        padding: 2px;
      }
      .color-text-input {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid var(--divider-color);
        border-radius: 4px;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        font-size: 0.95em;
      }
      .color-text-input:focus {
        outline: none;
        border-color: var(--primary-color);
      }
      /* PRO Section specific styling */
      details.section[data-section-id="overlay_image"] .section-summary,
      details.section[data-section-id="overlay_image"] .section-helper,
      details.section[data-section-id="overlay_image"] .field-helper,
      details.section[data-section-id="overlay_image"] ha-formfield,
      details.section[data-section-id="overlay_image"] .label,
      details.section[data-section-id="overlay_image"] label {
        color: #ff4444 !important;
      }
      details.section[data-section-id="overlay_image"] ha-form {
        --secondary-text-color: #ff4444 !important;
        --primary-text-color: #ff4444 !important;
        --mdc-theme-text-primary-on-background: #ff4444 !important;
        --paper-item-icon-color: #ff4444 !important;
        --mdc-theme-primary: #ff4444 !important;
        --ha-label-badge-color: #ff4444 !important;
      }
      /* Ensure everything inside the section content is forced to red */
      details.section[data-section-id="overlay_image"] .section-content * {
        --secondary-text-color: #ff4444 !important;
        --primary-text-color: #ff4444 !important;
      }
      
      /* PayPal Button Styling */
      .paypal-button-wrapper {
        margin: 10px 0 20px 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        padding: 15px;
        border: 2px dashed #ff4444;
        border-radius: 12px;
        background: rgba(255, 68, 68, 0.05);
        transition: all 0.3s ease;
      }
      .paypal-button-wrapper.authorized {
        margin: 5px 0 10px 0;
        padding: 8px;
        border-style: solid;
        border-color: #44ff44;
        background: rgba(68, 255, 68, 0.05);
      }
      .paypal-button-wrapper.authorized .paypal-instruction-note {
        display: none;
      }
      .paypal-link {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        background-color: #0070ba;
        color: white !important;
        text-decoration: none !important;
        padding: 12px 24px;
        border-radius: 25px;
        font-weight: bold;
        font-size: 1.1em;
        transition: all 0.2s ease;
        box-shadow: 0 4px 12px rgba(0, 112, 186, 0.3);
        width: fit-content;
      }
      .paypal-button-wrapper.authorized .paypal-link {
        padding: 6px 16px;
        font-size: 0.9em;
        background-color: #28a745;
        box-shadow: none;
      }
      .paypal-link:hover {
        background-color: #005ea6;
        transform: translateY(-2px);
      }
      .paypal-button-wrapper.authorized .paypal-link:hover {
        background-color: #218838;
      }
      .paypal-link:active {
        transform: translateY(0);
      }
      .paypal-icon {
        width: 24px;
        height: 24px;
        fill: white;
        transition: all 0.2s ease;
      }
      .paypal-button-wrapper.authorized .paypal-icon {
        width: 16px;
        height: 16px;
      }
      .paypal-instruction-note {
        font-size: 1.1em;
        text-align: center;
        color: #ff0000;
        font-weight: 700;
        text-decoration: underline;
        line-height: 1.4;
      }
      .about-content {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 0.95em;
      }
      .about-title {
        font-weight: 600;
        font-size: 1.05em;
      }
      .about-version {
        color: var(--secondary-text-color);
      }
      .about-links,
      .about-developers {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .about-label {
        font-weight: 500;
      }
      .about-separator {
        font-weight: 400;
      }
      .about-links a,
      .about-developers a {
        color: var(--primary-color);
        text-decoration: none;
      }
      .about-links a:hover,
      .about-developers a:hover {
        text-decoration: underline;
      }
    `;
    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(this._buildConfigContent());
    
    // Update section visibility after rendering
    setTimeout(() => {
      this._updateSectionVisibility(installationType);
    }, 0);
    
    this._rendered = true;
  }
}

if (!customElements.get('lumina-energy-card-editor')) {
  customElements.define('lumina-energy-card-editor', LuminaEnergyCardEditor);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'lumina-energy-card',
  name: 'Lumina Energy Card',
  description: 'Advanced energy flow visualization card with support for multiple PV strings and batteries',
  preview: true,
  documentationURL: 'https://github.com/Giorgio866/lumina-energy-card'
});
