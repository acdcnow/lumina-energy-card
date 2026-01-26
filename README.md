# Lumina Energy Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/custom-components/hacs)
![Version](https://img.shields.io/badge/version-1.1.41-blue.svg)

Repository: [https://github.com/Giorgio866/lumina-energy-card](https://github.com/Giorgio866/lumina-energy-card)

**[Install directly (HACS)][install]** · Support: [![Donate](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=for-the-badge&logo=paypal)](https://www.paypal.me/giorgiosalierno) · [![GitHub Sponsors](https://img.shields.io/badge/Sponsor-Giorgio866-pink?style=for-the-badge&logo=github-sponsors)](https://github.com/sponsors/Giorgio866)

[install]: https://my.home-assistant.io/redirect/hacs_repository/?owner=Giorgio866&repository=lumina-energy-card&category=frontend

[![Open your Home Assistant instance and add this repository to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)][install]

![Lumina Energy Card](https://raw.githubusercontent.com/Giorgio866/lumina-energy-card/main/Images/schermo.jpg)

*Lumina Energy Card – main view with energy flows, PV, battery, grid, and house*

---

## English

### Overview

Lumina Energy Card is a Home Assistant custom Lovelace card that displays animated energy flows (PV, battery, grid, load, heat pump, EV), aggregates PV strings and batteries, and supports optional EV charging and heat pump metrics. It includes **House Management** (cameras, lights, temperature, humidity), **interactive popups** with toggles, round buttons (Echo Alive, Text toggle, HOME), and **PRO** features (motion-based text visibility, overlay images, custom flows).

### Installation

**One-click install (HACS):**  
[![Open your Home Assistant instance and add this repository to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)][install]  
Click the badge → your Home Assistant opens → the repo is added to HACS. Then go to **HACS → Frontend**, search **Lumina Energy Card**, and install. Finally: **Dashboard → Edit → Add card → Lumina Energy Card**.

**HACS (manual):**
1. HACS → Frontend → Custom repositories → Add `https://github.com/Giorgio866/lumina-energy-card` (category: Dashboard).
2. Search **Lumina Energy Card**, install it.
3. Dashboard → Edit → Add card → **Lumina Energy Card**.

**Manual (no HACS):** Place `lumina-energy-card.js` and `lumina_background.png` in `/config/www/community/lumina-energy-card/`, add the Lovelace resource, restart Home Assistant.

### Minimal configuration

```yaml
type: custom:lumina-energy-card
sensor_pv1: sensor.solar_production
sensor_daily: sensor.daily_production
sensor_bat1_soc: sensor.battery_soc
sensor_bat1_power: sensor.battery_power
sensor_home_load: sensor.home_consumption
sensor_grid_power: sensor.grid_power
background_image: /local/community/lumina-energy-card/lumina_background.png
```

Use the card’s visual editor (Edit → Lumina) to configure entities, colors, and options.

---

### Latest features – how to use them

#### 1. House Management (cameras, lights, temperature, humidity)

- **HOME button:** A round **HOME** button appears on the card (together with Echo Alive and Text toggle, if enabled). Click it to open a **collapsible panel** on the right with **5 icons**: Camera, Lights, Temperature, Security, Humidity.
- **Assign entities:** In the editor, open the **“House Management”** section. Configure up to **6 entities per icon**:
  - **`house_camera_1` … `house_camera_6`:** Camera entities. Click the **Camera** icon → popup with a grid of your cameras.
  - **`house_lights_1` … `house_lights_6`:** Lights or switches. Click **Lights** → list with **ON / OFF** buttons.
  - **`house_temperature_1` … `house_temperature_6`:** Temperature sensors. Click **Temperature** → list with names and values (°C).
  - **`house_humidity_1` … `house_humidity_6`:** Humidity sensors. Click **Humidity** → list with names and values (%).
  - **`house_security_1` … `house_security_6`:** Reserved for future use.

**Cameras popup:**
- Each camera has a **▶ Start** and **■ Stop** button. Streams **do not** start automatically; click **▶ Start** to begin.
- If the camera supports it, the card uses **live streaming** (`ha-camera-stream`). Otherwise it shows **refreshed snapshots**.
- Close the popup with the **×** button or by clicking the dark overlay. Always click **■ Stop** before closing to free resources, or the card will stop streams automatically when you close.

**Lights popup:**
- Each light/switch shows its state (On/Off) and **ON** / **OFF** buttons. The card calls `light.turn_on` / `light.turn_off` or `switch.turn_on` / `switch.turn_off` automatically.

---

#### 2. Interactive popups (PV, Battery, Grid, House, Inverter)

- **Clickable areas:** Click on **PV** (daily badge / solar panels), **Battery**, **Grid**, **House**, or **Inverter** to open the corresponding popup.
- **Up to 6 lines per popup:** In the editor, use `sensor_popup_pv_1` … `sensor_popup_pv_6` (and similar for `house`, `bat`, `grid`, `inverter`). You can set custom names (`sensor_popup_pv_1_name`, etc.) and colors.
- **Toggles in popups:** If you assign **active entities** (e.g. lights, switches), the popup shows **toggles** to turn them on/off directly from the popup, without opening another card.
- **Closing:** Click the **popup background** (the semi‑transparent rect), not the content, to close. This keeps the popup easy to use without accidental closes.

---

#### 3. Echo Alive (Echo Show / Alexa)

- **Purpose:** Keeps the dashboard alive on **Echo Show** devices. The Silk browser tends to suspend or close the page; Echo Alive prevents that.
- **How to use:** Enable **`enable_echo_alive`** in the editor (Pulsanti e visibilità testi / Buttons and text visibility). A **round button** appears first on the left. On Echo Show, keep the dashboard open on a view that uses Lumina with Echo Alive enabled; the card will ping the page to avoid suspension.

---

#### 4. Text toggle and “Clean mode”

- **Text toggle:** Enable **`enable_text_toggle_button`** to show a round **Text** button. Click it to **show or hide** all text labels (PV, battery, grid, etc.) and enjoy a **clean**, graphic‑only view.
- **Initial state:** You can hide texts by default and reveal them only when needed via the toggle.

---

#### 5. Battery: flow vs charge/discharge mode

- **`battery_power_mode`** in the editor:
  - **`flow`** (default): One sensor **with sign** (`sensor_battery_flow`). **Positive** = charging (flow toward battery), **negative** = discharging (flow toward inverter).
  - **`charge_discharge`**: Two separate sensors, `sensor_battery_charge` and `sensor_battery_discharge`. Charge → flow toward battery, discharge → flow toward inverter.

---

#### 6. Animation style (shimmer, dashes, dots, arrows)

- **`animation_style`** (in **Colori flussi** / Flow colors, or **Stili animazioni**):  
  **`shimmer`** (default), **`dashes`**, **`dots`**, **`arrows`**.
- **`animation_speed_factor`:** Adjust speed (e.g. `1` = normal, `2` = faster). Use `0` to pause animations.

---

#### 7. PRO section (optional extras)

PRO features require a **PRO password** (`pro_password`), unlocked via the editor’s PRO section (PayPal support).

- **Text visibility motion sensor (`text_visibility_sensor`):**  
  Set a **motion** entity (e.g. `binary_sensor.corridoio_motion`). When motion is detected, **texts appear** and stay visible for **60 seconds** after the last motion. Ideal for **wall tablets with a camera**: texts show only when someone is in front of the device.  
  If you use the **Text toggle** to show texts, visibility is controlled only by the button (no motion timeout).

- **Overlay images:**  
  Add up to **5 transparent PNGs** over the main background (e.g. second car, pool, wind turbine). Configure **`overlay_image`** … **`overlay_image_5`**, position, size, and opacity in the PRO section.

- **Custom flows:**  
  Up to **5 custom energy flows** with their own sensor, path, color, and direction. Use **`custom_flow_1_enabled`**, **`custom_flow_1_sensor`**, **`custom_flow_1_path`** (or preset), **`custom_flow_1_color`**, etc.

- **Custom text:**  
  Up to **5 custom text labels** with optional sensor values, position, color, and font size.

---

### Quick reference

| Feature | Where to configure | What it does |
|--------|-------------------|--------------|
| House Management | Editor → **House Management** | Cameras, lights, temperature, humidity via HOME panel |
| Interactive popups | **Popup** options (`sensor_popup_*`) | PV, Battery, Grid, House, Inverter popups with toggles |
| Echo Alive | **`enable_echo_alive`** | Keeps dashboard alive on Echo Show |
| Text toggle | **`enable_text_toggle_button`** | Show/hide all texts (clean mode) |
| Battery mode | **`battery_power_mode`** | `flow` or `charge_discharge` |
| Animation style | **`animation_style`** | `shimmer`, `dashes`, `dots`, `arrows` |
| PRO (motion, overlay, etc.) | **PRO** section + **`pro_password`** | Motion-based text, overlay images, custom flows/text |

---

### Troubleshooting

- **Card not showing:** Ensure the Lovelace resource is added and clear the browser cache.
- **Values at zero:** Check entity IDs and that entities exist and are available.
- **Cameras 403 / not loading:** Cameras must expose `access_token` (most HA camera integrations do). Use **■ Stop** before closing the camera popup.
- **Editor slow:** Increase **`update_interval`** or reduce dashboard refresh frequency.

---

## Italiano

### Panoramica

Lumina Energy Card è una scheda Lovelace personalizzata per Home Assistant che mostra flussi energetici animati (PV, batteria, rete, carico, pompa di calore, EV), aggrega stringhe FV e batterie e supporta metriche opzionali per EV e pompa di calore. Include **Gestione casa** (telecamere, luci, temperatura, umidità), **popup interattivi** con toggle, pulsanti rotondi (Echo Alive, Toggle testi, HOME) e funzioni **PRO** (visibilità testi con sensore movimento, overlay, flussi personalizzati).

### Installazione

**Installa direttamente (HACS, un clic):**  
[![Apri Home Assistant e aggiungi questo repository a HACS](https://my.home-assistant.io/badges/hacs_repository.svg)][install]  
Clicca il badge → si apre la tua istanza Home Assistant → il repository viene aggiunto a HACS. Poi vai in **HACS → Frontend**, cerca **Lumina Energy Card** e installala. Infine: **Dashboard → Modifica → Aggiungi scheda → Lumina Energy Card**.

**HACS (manuale):**
1. HACS → Frontend → Custom repositories → Aggiungi `https://github.com/Giorgio866/lumina-energy-card` (categoria: Dashboard).
2. Cerca **Lumina Energy Card**, installala.
3. Dashboard → Modifica → Aggiungi scheda → **Lumina Energy Card**.

**Manuale (senza HACS):** Copia `lumina-energy-card.js` e `lumina_background.png` in `/config/www/community/lumina-energy-card/`, aggiungi la risorsa Lovelace e riavvia Home Assistant.

### Configurazione minima

```yaml
type: custom:lumina-energy-card
sensor_pv1: sensor.solar_production
sensor_daily: sensor.daily_production
sensor_bat1_soc: sensor.battery_soc
sensor_bat1_power: sensor.battery_power
sensor_home_load: sensor.home_consumption
sensor_grid_power: sensor.grid_power
background_image: /local/community/lumina-energy-card/lumina_background.png
```

Usa l’**editor visivo** della scheda (Modifica → Lumina) per configurare entità, colori e opzioni.

---

### Ultime novità – come usarle

#### 1. Gestione casa (telecamere, luci, temperatura, umidità)

- **Pulsante HOME:** Sulla card compare un pulsante rotondo **HOME** (insieme a Echo Alive e Toggle testi, se abilitati). Cliccandolo si apre un **pannello laterale** a destra con **5 icone**: Telecamera, Luci, Temperatura, Sicurezza, Umidità.
- **Assegnare le entità:** Nell’editor apri la sezione **“Gestione casa”**. Puoi configurare fino a **6 entità per icona**:
  - **`house_camera_1` … `house_camera_6`:** Entità telecamera. Clic sull’icona **Telecamera** → popup con griglia delle telecamere.
  - **`house_lights_1` … `house_lights_6`:** Luci o interruttori. Clic su **Luci** → elenco con pulsanti **ON** / **OFF**.
  - **`house_temperature_1` … `house_temperature_6`:** Sensori temperatura. Clic su **Temperatura** → elenco con nomi e valori (°C).
  - **`house_humidity_1` … `house_humidity_6`:** Sensori umidità. Clic su **Umidità** → elenco con nomi e valori (%).
  - **`house_security_1` … `house_security_6`:** Riservate per utilizzi futuri.

**Popup telecamere:**
- Ogni telecamera ha **▶ Avvia** e **■ Stop**. Gli stream **non** partono da soli: clicca **▶ Avvia** per avviare.
- Se la telecamera lo supporta, la card usa lo **streaming live** (`ha-camera-stream`). Altrimenti mostra **istantanee** aggiornate periodicamente.
- Chiudi il popup con **×** o cliccando sull’overlay scuro. È bene cliccare **■ Stop** prima di chiudere; in alternativa la card interrompe gli stream automaticamente alla chiusura.

**Popup luci:**
- Ogni luce/interruttore mostra lo stato (On/Off) e i pulsanti **ON** / **OFF**. La card chiama `light.turn_on` / `light.turn_off` o `switch.turn_on` / `switch.turn_off` in automatico.

---

#### 2. Popup interattivi (PV, Batteria, Rete, Casa, Inverter)

- **Aree cliccabili:** Clicca su **PV** (badge giornaliero / pannelli), **Batteria**, **Rete**, **Casa** o **Inverter** per aprire il rispettivo popup.
- **Fino a 6 righe per popup:** Nell’editor usa `sensor_popup_pv_1` … `sensor_popup_pv_6` (e analoghi per `house`, `bat`, `grid`, `inverter`). Puoi impostare nomi personalizzati (`sensor_popup_pv_1_name`, ecc.) e colori.
- **Toggle nei popup:** Se assegni **entità attive** (es. luci, interruttori), nel popup compaiono **toggle** per accenderle/spegnerle direttamente, senza usare altre schede.
- **Chiusura:** Clicca sullo **sfondo del popup** (il rettangolo semi‑trasparente), non sul contenuto, per chiudere. Così si evita di chiudere per sbaglio mentre si usano i toggle.

---

#### 3. Echo Alive (Echo Show / Alexa)

- **Scopo:** Mantiene la dashboard attiva sugli **Echo Show**. Il browser Silk tende a sospendere o chiudere la pagina; Echo Alive lo contrasta.
- **Uso:** Abilita **`enable_echo_alive`** nell’editor (Pulsanti e visibilità testi). Compare un **pulsante rotondo** come primo a sinistra. Su Echo Show, tieni la dashboard aperta su una vista con Lumina e Echo Alive attivo; la card “sveglia” la pagina per evitare la sospensione.

---

#### 4. Toggle testi e “modalità pulita”

- **Toggle testi:** Abilita **`enable_text_toggle_button`** per mostrare il pulsante rotondo **Testo**. Cliccandolo **mostri o nascondi** tutte le etichette (PV, batteria, rete, ecc.) e usi la card in **modalità pulita**, solo grafica.
- **Stato iniziale:** Puoi nascondere i testi di default e mostrarli solo quando serve tramite il toggle.

---

#### 5. Batteria: modalità flow e carica/scarica

- **`battery_power_mode`** nell’editor:
  - **`flow`** (predefinito): Un solo sensore **con segno** (`sensor_battery_flow`). **Positivo** = carica (flusso verso batteria), **negativo** = scarica (flusso verso inverter).
  - **`charge_discharge`**: Due sensori separati, `sensor_battery_charge` e `sensor_battery_discharge`. Carica → flusso verso batteria, scarica → flusso verso inverter.

---

#### 6. Stile animazioni (shimmer, tratteggi, punti, frecce)

- **`animation_style`** (in **Colori flussi** o **Stili animazioni**):  
  **`shimmer`** (predefinito), **`dashes`**, **`dots`**, **`arrows`**.
- **`animation_speed_factor`:** Regola la velocità (es. `1` = normale, `2` = più veloce). Con `0` le animazioni sono in pausa.

---

#### 7. Sezione PRO (funzionalità extra)

Le funzioni PRO richiedono la **password PRO** (`pro_password`), sbloccabile dalla sezione PRO dell’editor (supporto PayPal).

- **Sensore movimento visibilità testi (`text_visibility_sensor`):**  
  Imposta un’entità **movimento** (es. `binary_sensor.corridoio_motion`). Al **movimento** i **testi compaiono** e restano visibili per **60 secondi** dopo l’ultimo movimento. Ideale per **tablet a muro con telecamera**: i testi si vedono solo quando qualcuno è davanti al dispositivo.  
  Se usi il **Toggle testi** per mostrare i testi, la visibilità dipende solo dal pulsante (nessun timeout da movimento).

- **Overlay immagini:**  
  Fino a **5 PNG trasparenti** sopra lo sfondo principale (es. seconda auto, piscina, pala eolica). Configura **`overlay_image`** … **`overlay_image_5`**, posizione, dimensione e opacità nella sezione PRO.

- **Flussi personalizzati:**  
  Fino a **5 flussi energetici** custom con sensore, percorso, colore e direzione propri. Usa **`custom_flow_1_enabled`**, **`custom_flow_1_sensor`**, **`custom_flow_1_path`** (o preset), **`custom_flow_1_color`**, ecc.

- **Testi personalizzati:**  
  Fino a **5 etichette** custom con eventuale valore da sensore, posizione, colore e dimensione font.

---

### Riferimento rapido

| Funzione | Dove configurarla | Cosa fa |
|----------|-------------------|---------|
| Gestione casa | Editor → **Gestione casa** | Telecamere, luci, temperatura, umidità dal pannello HOME |
| Popup interattivi | Opzioni **Popup** (`sensor_popup_*`) | Popup PV, Batteria, Rete, Casa, Inverter con toggle |
| Echo Alive | **`enable_echo_alive`** | Mantiene la dashboard attiva su Echo Show |
| Toggle testi | **`enable_text_toggle_button`** | Mostra/nascondi tutti i testi (modalità pulita) |
| Modalità batteria | **`battery_power_mode`** | `flow` o `charge_discharge` |
| Stile animazioni | **`animation_style`** | `shimmer`, `dashes`, `dots`, `arrows` |
| PRO (movimento, overlay, ecc.) | Sezione **PRO** + **`pro_password`** | Testi su movimento, overlay, flussi/testi custom |

---

### Risoluzione problemi

- **La scheda non compare:** Verifica che la risorsa Lovelace sia aggiunta e svuota la cache del browser.
- **Valori a zero:** Controlla gli entity ID e che le entità esistano e siano disponibili.
- **Telecamere 403 / non caricano:** Le telecamere devono esporre `access_token` (la maggior parte delle integrazioni HA lo fa). Usa **■ Stop** prima di chiudere il popup telecamere.
- **Editor lento:** Aumenta **`update_interval`** o riduci la frequenza di aggiornamento della dashboard.

---

### Licenza e supporto

- **Licenza:** MIT. Vedi [LICENSE](LICENSE).
- **Segnalazioni e richieste:** [GitHub](https://github.com/Giorgio866/lumina-energy-card).

© 2025 Giorgio866 e contributors.
