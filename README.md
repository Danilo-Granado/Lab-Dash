# Lab Analysis Dashboard

Local web dashboard for live equipment monitoring, PO-linked result capture,
and CSV logging. Currently supports Moisture Content (Ohaus MB27) and
Viscosity (IKA Rotavisc LO-VI).

## Requirements

Python 3.10+

```
pip install -r requirements.txt
```

## Running

```
python app.py
```

Then open **http://localhost:5000** in your browser.

## Typical session flow

1. **Overview tab** — enter a PO number, select a product profile (or custom tests), connect each instrument on its COM port, start the session.
2. **Equipment tabs** — configure test parameters, start, watch live readings.
3. When a test completes, review the result in the confirmation modal and save to PO.
4. **History tab** — filter results by PO or test type; all saved results are in `logs/results.csv`.

## Project structure

```
lab_dashboard/
├── app.py                  Flask entry point
├── config.py               Default ports, intervals, paths
├── session_state.py        In-memory session (PO, active tests, drivers)
├── requirements.txt
│
├── equipment/
│   ├── base.py             Abstract base — subclass this for new equipment
│   ├── registry.py         Maps test_id → driver class (add new lines here)
│   ├── moisture.py         Ohaus MB27 driver
│   └── viscosity.py        IKA Rotavisc LO-VI driver
│
├── storage/
│   └── csv_writer.py       save_result() / get_results() — swap for DB here
│
├── profiles/
│   └── profiles.json       Product profiles (test selections per product)
│
├── routes/
│   ├── api.py              REST: session, connect, start/stop, status, ports
│   ├── stream.py           SSE: live reading streams per equipment
│   └── storage.py          REST: save result, fetch history
│
├── static/
│   ├── app.js              Tab routing, session management, save modal
│   ├── css/style.css       Design system
│   └── tabs/
│       ├── overview.js     Session setup, port config, equipment status
│       ├── viscosity.js    Live viscosity panel
│       ├── moisture.js     Moisture test launcher + result
│       └── history.js      Results table with filtering
│
└── templates/
    └── index.html          SPA shell
```

## Adding a new equipment type

1. Create `equipment/<name>.py`, subclass `EquipmentBase`, implement all abstract methods.
2. Add one line to `equipment/registry.py`: `"<test_id>": YourClass`.
3. Create `static/tabs/<name>.js` with an `init<Name>Tab(panel)` function.
4. Register the init call in `static/app.js` (inside `applySession`).
5. Add the test to relevant profiles in `profiles/profiles.json`.

## Standard profiles.json

```
{
  "product_b": {
    "display_name": "Product B",
    "tests": ["moisture"]
  },

  "product_c": {
    "display_name": "Product C",
    "tests": ["viscosity"]
  }
}
```

## Switching to a database

Replace `storage/csv_writer.py` with a new module that exposes the same
`save_result()` and `get_results()` signatures. Update the import in
`routes/storage.py`. Nothing else changes.

## Default serial ports

| Equipment | Default |
|-----------|---------|
| Moisture (MB27)     | COM4 |
| Viscosity (Rotavisc) | COM3 |

Override in `config.py` or change at runtime from the Overview tab.
