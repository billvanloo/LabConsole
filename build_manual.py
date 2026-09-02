#!/usr/bin/env python3
"""Generate static/docs/LabConsole-Manual.pdf from the Technical Archive content.

Print-friendly rendition: white pages with the console's line-art language in
ink-safe colors (navy strokes, amber section indices, red reserved for error
signaling), matching the on-screen archive structurally section for section.
"""
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph,
                                Spacer, Table, TableStyle, PageBreak, Flowable,
                                KeepTogether)

NAVY = colors.HexColor("#12264d")
CYAN = colors.HexColor("#0e7ea8")
AMBER = colors.HexColor("#a8720e")
ALERT = colors.HexColor("#c33a12")
VIOLET = colors.HexColor("#6a3fb0")
DIM = colors.HexColor("#5f7ea6")
INK = colors.HexColor("#25324a")
PANEL = colors.HexColor("#f2f5fa")

W, H = letter
MONO, MONO_B = "Courier", "Courier-Bold"

S = dict(
    h1=ParagraphStyle("h1", fontName=MONO_B, fontSize=17, leading=21,
                      textColor=NAVY, spaceAfter=2),
    h1sub=ParagraphStyle("h1sub", fontName=MONO, fontSize=8, leading=11,
                         textColor=DIM, spaceAfter=16),
    h2=ParagraphStyle("h2", fontName=MONO_B, fontSize=11.5, leading=15,
                      textColor=AMBER, spaceBefore=16, spaceAfter=8),
    h3=ParagraphStyle("h3", fontName=MONO_B, fontSize=9.5, leading=13,
                      textColor=INK, spaceBefore=10, spaceAfter=5),
    body=ParagraphStyle("body", fontName=MONO, fontSize=8.6, leading=13.2,
                        textColor=INK, spaceAfter=8),
    li=ParagraphStyle("li", fontName=MONO, fontSize=8.6, leading=13,
                      textColor=INK, leftIndent=14, bulletIndent=4, spaceAfter=4),
    code=ParagraphStyle("code", fontName=MONO, fontSize=7.8, leading=11.5,
                        textColor=NAVY, backColor=PANEL, borderColor=colors.HexColor("#d7deea"),
                        borderWidth=0.7, borderPadding=7, spaceAfter=10),
    cap=ParagraphStyle("cap", fontName=MONO, fontSize=7, leading=10,
                       textColor=DIM, spaceBefore=3, spaceAfter=12),
    cell=ParagraphStyle("cell", fontName=MONO, fontSize=7.8, leading=11, textColor=INK),
    cellk=ParagraphStyle("cellk", fontName=MONO_B, fontSize=7.8, leading=11, textColor=AMBER),
    callout=ParagraphStyle("callout", fontName=MONO, fontSize=8, leading=12, textColor=INK),
)


def header_footer(canv, doc):
    canv.saveState()
    canv.setStrokeColor(NAVY); canv.setLineWidth(0.8)
    canv.line(0.8 * inch, H - 0.62 * inch, W - 0.8 * inch, H - 0.62 * inch)
    canv.setFont(MONO_B, 8); canv.setFillColor(NAVY)
    canv.drawString(0.8 * inch, H - 0.55 * inch, "L A B   C O N S O L E")
    canv.setFont(MONO, 6.5); canv.setFillColor(DIM)
    canv.drawRightString(W - 0.8 * inch, H - 0.55 * inch, "TECHNICAL ARCHIVE — PRINTED MANUAL")
    canv.drawCentredString(W / 2, 0.5 * inch, f"— {doc.page} —")
    canv.restoreState()


def rule(color=colors.HexColor("#d7deea"), space=6):
    class _R(Flowable):
        def wrap(self, aw, ah): self.aw = aw; return aw, space
        def draw(self):
            self.canv.setStrokeColor(color); self.canv.setLineWidth(0.7)
            self.canv.line(0, space / 2, self.aw, space / 2)
    return _R()


def callout(kind, title, text):
    col = {"note": CYAN, "warn": AMBER, "danger": ALERT}[kind]
    t = Table([[Paragraph(f"<font color='#{col.hexval()[2:]}'><b>{title}</b></font><br/>{text}",
                          S["callout"])]], colWidths=[6.4 * inch])
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.9, col),
        ("LINEBEFORE", (0, 0), (0, -1), 2.4, col),
        ("BACKGROUND", (0, 0), (-1, -1), PANEL),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return [Spacer(1, 2), t, Spacer(1, 10)]


def ref_table(header, rows, widths):
    data = [[Paragraph(f"<b>{h}</b>", S["cell"]) for h in header]] if header else []
    for r in rows:
        data.append([Paragraph(r[0], S["cellk"])] + [Paragraph(c, S["cell"]) for c in r[1:]])
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#c8d2e2")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), PANEL))
    t.setStyle(TableStyle(style))
    return [t, Spacer(1, 10)]


# ------------------------------------------------------------------ figures
class PanelFig(Flowable):
    """Vector drawing of two console panels: PRINTING and ERROR."""
    def wrap(self, aw, ah): return aw, 2.0 * inch

    def _panel(self, c, x, y, w, h, err=False):
        c.setLineWidth(1.4 if err else 0.9)
        c.setStrokeColor(ALERT if err else colors.HexColor("#9aa7bd"))
        c.roundRect(x, y, w, h, 9)
        c.setLineWidth(0.7); c.setStrokeColor(colors.HexColor("#c8d2e2"))
        c.roundRect(x + 5, y + 5, w - 10, h - 10, 6)

    def draw(self):
        c = self.canv
        pw, ph = 2.95 * inch, 1.85 * inch
        # ---- printing panel
        x, y = 0.1 * inch, 0.05 * inch
        self._panel(c, x, y, pw, ph)
        c.setFillColor(AMBER); c.circle(x + 0.22 * inch, y + ph - 0.22 * inch, 2.6, fill=1, stroke=0)
        c.setFont(MONO_B, 7.5); c.setFillColor(NAVY)
        c.drawString(x + 0.34 * inch, y + ph - 0.25 * inch, "VOYAGER-01")
        c.setFont(MONO, 5.5); c.setFillColor(DIM)
        c.drawRightString(x + pw - 0.14 * inch, y + ph - 0.25 * inch, "X1 CARBON")
        c.setFont(MONO_B, 10); c.setFillColor(AMBER)
        c.drawString(x + 0.2 * inch, y + ph - 0.52 * inch, "P R I N T I N G")
        c.setFont(MONO, 6.4); c.setFillColor(INK)
        c.drawString(x + 0.2 * inch, y + ph - 0.70 * inch, "sensor_mount_bracket_v3.3mf")
        c.setFillColor(DIM)
        for i, (k, v) in enumerate([("LAYER", "143 / 230"), ("NOZZLE / BED", "220\u00b0 / 65\u00b0"),
                                    ("TIME LEFT", "1H 47M")]):
            yy = y + ph - (0.88 + i * 0.16) * inch
            c.drawString(x + 0.2 * inch, yy, k)
            c.drawRightString(x + pw - 0.2 * inch, yy, v)
        # progress bar
        bx, by, bw = x + 0.2 * inch, y + 0.18 * inch, pw - 0.7 * inch
        c.setStrokeColor(CYAN); c.setLineWidth(0.8); c.rect(bx, by, bw, 0.09 * inch)
        c.setFillColor(AMBER); c.rect(bx, by, bw * 0.62, 0.09 * inch, fill=1, stroke=0)
        c.setFont(MONO_B, 7); c.drawRightString(x + pw - 0.14 * inch, by, "62%")
        # ---- error panel
        x2 = x + pw + 0.25 * inch
        self._panel(c, x2, y, pw, ph, err=True)
        c.setFillColor(ALERT); c.circle(x2 + 0.22 * inch, y + ph - 0.22 * inch, 2.6, fill=1, stroke=0)
        c.setFont(MONO_B, 7.5); c.setFillColor(NAVY)
        c.drawString(x2 + 0.34 * inch, y + ph - 0.25 * inch, "SCOUT-03")
        c.setFont(MONO, 5.5); c.setFillColor(DIM)
        c.drawRightString(x2 + pw - 0.14 * inch, y + ph - 0.25 * inch, "A1 MINI")
        c.setFont(MONO_B, 10); c.setFillColor(ALERT)
        c.drawString(x2 + 0.2 * inch, y + ph - 0.52 * inch, "E R R O R")
        c.setFont(MONO, 6.2); c.setFillColor(ALERT)
        c.drawString(x2 + 0.2 * inch, y + ph - 0.70 * inch, "HMS 0700-8000-0002-0001")
        c.setFillColor(INK)
        c.drawString(x2 + 0.2 * inch, y + ph - 0.84 * inch, "CHECK PRINTER, CLEAR FAULT, RESUME.")
        c.setFont(MONO, 6.4); c.setFillColor(DIM)
        c.drawString(x2 + 0.2 * inch, y + ph - 1.04 * inch, "JOB HELD AT")
        c.drawRightString(x2 + pw - 0.2 * inch, y + ph - 1.04 * inch, "37%")
        bx = x2 + 0.2 * inch
        c.setStrokeColor(CYAN); c.setLineWidth(0.8); c.rect(bx, by, bw, 0.09 * inch)
        c.setFillColor(ALERT); c.rect(bx, by, bw * 0.37, 0.09 * inch, fill=1, stroke=0)
        c.setFont(MONO, 5); c.setFillColor(ALERT)
        c.drawString(x2 + 0.2 * inch, y - 0.0 * inch + 0.02 * inch, "")
        c.setFont(MONO, 5.2); c.setFillColor(ALERT)
        c.drawCentredString(x2 + pw / 2, y + 0.055 * inch, "BEZEL FLASHES RED IN SYNC WITH LAMP")


class ArchFig(Flowable):
    """Architecture diagram."""
    def wrap(self, aw, ah): return aw, 2.5 * inch

    def draw(self):
        c = self.canv
        def box(x, y, w, h, label, sub, col=NAVY):
            c.setStrokeColor(col); c.setLineWidth(1); c.roundRect(x, y, w, h, 7)
            c.setFont(MONO_B, 7.5); c.setFillColor(col)
            c.drawCentredString(x + w / 2, y + h - 0.22 * inch, label)
            c.setFont(MONO, 5.6); c.setFillColor(DIM)
            c.drawCentredString(x + w / 2, y + h - 0.36 * inch, sub)
        def arrow(x1, y1, x2, y2, col):
            c.setStrokeColor(col); c.setLineWidth(0.9); c.line(x1, y1, x2, y2)
            c.setFillColor(col)
            p = c.beginPath(); p.moveTo(x2, y2); p.lineTo(x2 - 5, y2 + 3); p.lineTo(x2 - 5, y2 - 3); p.close()
            c.drawPath(p, fill=1, stroke=0)
        u = inch
        box(0.1 * u, 1.6 * u, 1.7 * u, 0.7 * u, "BROWSER", "WALL DISPLAY / PHONE", CYAN)
        c.setStrokeColor(NAVY); c.setLineWidth(1); c.roundRect(2.35 * u, 0.15 * u, 1.9 * u, 2.25 * u, 7)
        c.setFont(MONO_B, 7.5); c.setFillColor(NAVY)
        c.drawCentredString(3.3 * u, 2.2 * u, "RASPBERRY PI")
        for i, lbl in enumerate(["AIOHTTP SERVER", "MQTT CLIENTS \u00d7N", "CAMERA RELAYS", "FTPS + SSDP"]):
            yy = 1.72 * u - i * 0.45 * u
            c.setStrokeColor(colors.HexColor("#8fa3c5")); c.roundRect(2.5 * u, yy, 1.6 * u, 0.34 * u, 4)
            c.setFont(MONO, 6.2); c.setFillColor(INK)
            c.drawCentredString(3.3 * u, yy + 0.12 * u, lbl)
        for i, (lbl, sub) in enumerate([("X1 CARBON", "MQTT :8883 \u00b7 RTSPS :322"),
                                        ("H2D", "MQTT :8883 \u00b7 RTSPS :322"),
                                        ("A1 MINI", "MQTT :8883 \u00b7 CAM :6000")]):
            yy = 1.75 * u - i * 0.82 * u
            box(4.85 * u, yy, 1.75 * u, 0.62 * u, lbl, sub, AMBER)
            arrow(4.25 * u, yy + 0.31 * u, 4.83 * u, yy + 0.31 * u, AMBER)
        arrow(1.8 * u, 2.0 * u, 2.33 * u, 2.0 * u, CYAN)
        arrow(2.33 * u, 1.8 * u, 1.8 * u, 1.8 * u, CYAN)
        c.setFont(MONO, 5.4); c.setFillColor(DIM)
        c.drawCentredString(2.07 * u, 2.08 * u, "HTTP/WS")


class StateLegendFig(Flowable):
    """Lamp legend row."""
    def wrap(self, aw, ah): return aw, 0.35 * inch

    def draw(self):
        c = self.canv
        items = [("IDLE", CYAN), ("PRINTING", AMBER), ("PAUSED", VIOLET),
                 ("ERROR", ALERT), ("OFFLINE", colors.HexColor("#8b93a5"))]
        x = 0.05 * inch
        for label, col in items:
            c.setFillColor(col); c.circle(x + 4, 0.14 * inch, 3.4, fill=1, stroke=0)
            c.setFont(MONO_B, 7.5); c.setFillColor(col)
            c.drawString(x + 12, 0.105 * inch, label)
            x += (0.62 + 0.14 * len(label)) * inch


# ------------------------------------------------------------------ content
def P(txt): return Paragraph(txt, S["body"])
def LI(txt): return Paragraph(txt, S["li"], bulletText="\u2022")
def CODE(txt): return Paragraph(txt.replace("\n", "<br/>").replace(" ", "&nbsp;"), S["code"])


def build(out="static/docs/LabConsole-Manual.pdf"):
    doc = BaseDocTemplate(out, pagesize=letter,
                          leftMargin=0.8 * inch, rightMargin=0.8 * inch,
                          topMargin=0.85 * inch, bottomMargin=0.75 * inch,
                          title="Lab Console Manual", author="Lab Console")
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([PageTemplate(id="p", frames=[frame], onPage=header_footer)])
    e = []

    # ---- cover / overview
    e += [Spacer(1, 8), Paragraph("LAB CONSOLE — MANUAL", S["h1"]),
          Paragraph("OPERATOR GUIDE \u00b7 ADMIN GUIDE \u00b7 TECHNICAL REFERENCE \u00b7 PRINTED FROM THE TECHNICAL ARCHIVE", S["h1sub"]),
          P("<b>Lab Console</b> is a wall-mountable web dashboard for monitoring and "
            "controlling a fleet of Bambu Lab 3D printers (1\u201310) over the local network. "
            "It runs on a Raspberry Pi 3 or newer and is viewed in any browser \u2014 typically "
            "a small touch screen in the lab. The fleet view gives at-a-glance state for every "
            "printer; tapping a panel opens a full console with live camera, telemetry, and "
            "controls including pause, resume, stop, and starting new prints."),
          Paragraph("00 \u00b7 ARCHITECTURE AT A GLANCE", S["h2"]), rule(),
          ArchFig(),
          Paragraph("FIG 0.1 \u2014 ONE MQTT LINK PER PRINTER; CAMERAS RELAYED ONE AT A TIME; "
                    "STATE PUSHED TO BROWSERS OVER A WEBSOCKET.", S["cap"]),
          P("The Pi holds one always-on MQTT connection per printer (Developer Mode, TLS, port "
            "8883) for status and control, relays one live camera at a time as MJPEG, moves "
            "print files over FTPS, and listens for SSDP announcements so printers are found "
            "again after DHCP changes."),
          *callout("note", "\u25c8 DEMO MODE",
                   "Run <font face='Courier'>python3 server.py --demo</font> for a fully simulated "
                   "fleet \u2014 every state on a timer, working controls, no printers contacted. A "
                   "violet DEMO badge shows in the status bar. Ideal for training."),
          PageBreak()]

    # ---- operator guide
    e += [Paragraph("OPERATOR GUIDE", S["h1"]),
          Paragraph("READING AND OPERATING THE FLEET CONSOLE", S["h1sub"]),
          Paragraph("01 \u00b7 READING THE DASHBOARD", S["h2"]), rule(),
          P("The status bar shows fleet totals, the clock, and a <b>LINK</b> indicator for the "
            "browser\u2019s connection to the Pi \u2014 if LINK is red, the view may be stale. Each "
            "printer is a bezel-framed panel that cycles every ~8 seconds between its status "
            "readout, an ambient scanner animation (idle printers only), and \u2014 for one printer "
            "at a time \u2014 the live camera slot. The state lamp in the panel header never cycles "
            "away. Tap any panel for its detail console."),
          Paragraph("02 \u00b7 PRINTER STATES", S["h2"]), rule(),
          StateLegendFig(), Spacer(1, 6)]
    e += ref_table(None, [
        ["IDLE", "Steady cyan lamp. Online and ready; readout shows temperatures and the last job."],
        ["PRINTING", "Pulsing amber. File name, layer count, temperatures, time remaining, progress."],
        ["PAUSED", "Steady violet. Job held; resume from the detail view."],
        ["ERROR", "Blinking red lamp <b>and the entire panel bezel flashes red in sync</b>. Readout lists HMS code(s). Error panels never cycle away."],
        ["OFFLINE", "Dark lamp. No MQTT link \u2014 check power, network, Developer Mode."],
    ], [0.9 * inch, 5.5 * inch])
    e += [PanelFig(),
          Paragraph("FIG 2.1 \u2014 A PRINTING PANEL AND AN ERROR PANEL AS DRAWN ON THE CONSOLE.", S["cap"]),
          Paragraph("03 \u00b7 CAMERA VIEWS", S["h2"]), rule(),
          P("One camera relay runs at a time; the dashboard\u2019s live slot rotates through the "
            "fleet, and opening a detail view pins that printer\u2019s camera. X1 Carbon / H2D "
            "provide real video (RTSPS, relayed at reduced frame rate); A1 / A1 Mini provide "
            "roughly one frame per second from the chamber camera \u2014 the slideshow feel is the "
            "hardware\u2019s design, not a fault."),
          *callout("note", "\u25c8 NOTE",
                   "The white \u25cf LIVE tag is an indicator, not an alarm \u2014 red is reserved "
                   "exclusively for error signaling. A grey NO SIGNAL tag means liveview is "
                   "unavailable; status and controls still work."),
          Paragraph("04 \u00b7 CONTROLS", S["h2"]), rule()]
    e += ref_table(["CONTROL", "BEHAVIOR"], [
        ["\u23f8 PAUSE / \u25b6 RESUME", "Holds or resumes the job; the button swaps by state. Resume also clears a recoverable ERROR (e.g. after feeding filament)."],
        ["\u25a0 STOP", "Aborts the job. Always asks for confirmation first."],
        ["\u2600 LIGHT", "Toggles the chamber light \u2014 useful before judging a camera view."],
        ["\u25b2 START PRINT\u2026", "Pick a sliced .3mf on the printer\u2019s SD card, or upload one. Selecting a file arms START."],
    ], [1.5 * inch, 4.9 * inch])
    e += callout("danger", "\u25b2 CAUTION",
                 "STOP cannot be undone \u2014 a stopped job restarts from zero. The console always "
                 "asks for confirmation before sending it.")
    e += callout("warn", "\u25c8 GOOD PRACTICE",
                 "Before starting a print remotely, use the camera to confirm the bed is clear.")
    e += [PageBreak()]

    # ---- admin guide
    e += [Paragraph("ADMIN GUIDE", S["h1"]),
          Paragraph("SETUP, CONFIGURATION, AND CARE OF THE CONSOLE", S["h1sub"]),
          Paragraph("01 \u00b7 PRINTER PREREQUISITES (EACH PRINTER)", S["h2"]), rule(),
          LI("Update to recent firmware."),
          LI("Switch to <b>LAN Only Mode</b> and enable <b>Developer Mode</b> (Settings \u2192 "
             "General/Network). This opens the local MQTT, live-stream, and FTP channels. "
             "Developer Mode printers cannot simultaneously connect to Bambu Cloud."),
          LI("Record the <b>Access Code</b> (Settings \u2192 Network) and <b>Serial Number</b> "
             "(Settings \u2192 Device)."),
          LI("<b>X1-series / H2D only:</b> enable <b>LAN Mode Liveview</b> for the camera."),
          Spacer(1, 4),
          *callout("warn", "\u25c8 NOTE",
                   "Regenerating a printer\u2019s access code invalidates the one in config.json \u2014 "
                   "the panel goes OFFLINE until the config is updated."),
          Paragraph("02 \u00b7 INSTALLATION", S["h2"]), rule(),
          CODE("sudo apt update && sudo apt install -y python3-pip ffmpeg\n"
               "cd /home/pi/lab-console\n"
               "pip3 install -r requirements.txt --break-system-packages\n"
               "cp config.example.json config.json   # fill in serials + access codes\n"
               "python3 server.py                    # open http://<pi>:8080"),
          Paragraph("RUNNING ON UBUNTU / OTHER LINUX HOSTS", S["h3"]),
          P("The console runs unchanged on a standard Ubuntu machine (desktop or server) "
            "instead of a Raspberry Pi \u2014 nothing in the code is Pi-specific. Install the "
            "same way, shown above. A few environment differences to check:"),
          LI("<b>Firewall</b> \u2014 Ubuntu often runs ufw, which Raspberry Pi OS does not "
             "enable by default. Allow the port: <font face='Courier'>sudo ufw allow "
             "8080/tcp</font>."),
          LI("<b>Same LAN as the printers</b> \u2014 SSDP discovery is passive; the host must "
             "sit on the same network segment as the printers, not behind a router hop or "
             "separate VLAN."),
          LI("<b>Laptops</b> \u2014 Wi-Fi power-saving can drop the idle discovery socket or "
             "let the machine sleep. Disable suspend/Wi-Fi power management, or use a "
             "wired/always-on machine."),
          Spacer(1, 4),
          *callout("note", "\u25c8 NOTE",
                   "A typical Ubuntu machine has far more headroom than a Pi 3 \u2014 "
                   "camera.max_streams in the config can safely be raised above 1 for multiple "
                   "simultaneous live camera views."),
          Paragraph("03 \u00b7 CONFIG REFERENCE \u2014 PER PRINTER", S["h2"]), rule()]
    e += ref_table(["FIELD", "MEANING"], [
        ["id", "Short unique key; used in URLs."],
        ["name / model", "Display name and model label on the dashboard."],
        ["serial", "Printer serial \u2014 used for MQTT topics and SSDP matching."],
        ["access_code", "LAN access code from the printer screen."],
        ["ip", "Optional; discovery fills and updates it. A static/reserved address makes startup instant."],
        ["camera", "rtsp (X1-series, H2D) \u00b7 chamber (A1/A1 Mini/P1) \u00b7 none."],
    ], [1.3 * inch, 5.1 * inch])
    e += [Paragraph("CONFIG REFERENCE \u2014 GLOBAL", S["h3"])]
    e += ref_table(["FIELD", "DEFAULT", "MEANING"], [
        ["http_port", "8080", "Port the console serves on."],
        ["max_upload_mb", "200", "Upload size limit."],
        ["camera.max_streams", "1", "Concurrent camera relays; keep 1 on a Pi 3. New viewers evict the oldest."],
        ["camera.rtsp_fps / rtsp_width", "8 / 640", "RTSPS transcode cost knobs."],
        ["sdcard_url_base", "file:///sdcard/", "Switch to file:///mnt/sdcard/ if start-print reports file-not-found."],
    ], [1.7 * inch, 1.0 * inch, 3.7 * inch])
    e += [Paragraph("04 \u00b7 RUN AT BOOT / KIOSK DISPLAY", S["h2"]), rule(),
          CODE("sudo cp lab-console.service /etc/systemd/system/\n"
               "sudo systemctl daemon-reload\n"
               "sudo systemctl enable --now lab-console\n"
               "journalctl -u lab-console -f     # logs"),
          P("For a wall display, run a kiosk browser: "
            "<font face='Courier'>chromium-browser --kiosk http://localhost:8080</font>. The "
            "frontend pauses panel cycling while the tab is hidden."),
          Paragraph("05 \u00b7 TROUBLESHOOTING", S["h2"]), rule()]
    e += ref_table(["SYMPTOM", "LIKELY CAUSE / FIX"], [
        ["Panel OFFLINE", "Printer unreachable over MQTT. Check power, LAN, Developer Mode, access code. Discovery re-finds moved printers within about a minute."],
        ["X1/H2D camera NO SIGNAL", "LAN Mode Liveview off, or ffmpeg missing. Some H2D firmware temporarily shipped without local liveview \u2014 status/control keep working."],
        ["A1 camera ~1 fps", "Hardware rate of the chamber camera; not a fault."],
        ["Start print: file not found", "Switch sdcard_url_base to file:///mnt/sdcard/."],
        ["SD list empty", "Only SD root files are listed; uploads go to the root."],
        ["LINK red in status bar", "Browser lost its WebSocket; it reconnects automatically. If persistent, check the service logs."],
    ], [1.7 * inch, 4.7 * inch])
    e += callout("danger", "\u25b2 SECURITY",
                 "No login; access codes live in config.json. Keep the console on a trusted "
                 "LAN/VLAN and do not expose port 8080 to the internet.")
    e += [PageBreak()]

    # ---- technical reference
    e += [Paragraph("TECHNICAL REFERENCE", S["h1"]),
          Paragraph("PROTOCOLS, SCHEMAS, AND THE HTTP API", S["h1sub"]),
          P("Printer-side protocols are the community-documented LAN Developer Mode interfaces "
            "(OpenBambuAPI; Bambu Lab wiki, third-party integration). Nothing uses Bambu Cloud."),
          Paragraph("01 \u00b7 MQTT (STATUS + CONTROL)", S["h2"]), rule(),
          P("One TLS connection per printer to port <b>8883</b>, username "
            "<font face='Courier'>bblp</font>, password = access code, self-signed certificate "
            "accepted."),
          CODE("device/<SERIAL>/report    <-  status pushes (partial JSON, merged)\n"
               "device/<SERIAL>/request   ->  commands")]
    e += ref_table(["ACTION", "PAYLOAD (ABBREVIATED)"], [
        ["full refresh", '{"pushing":{"command":"pushall"}}'],
        ["pause / resume / stop", '{"print":{"command":"pause"|"resume"|"stop","param":""}}'],
        ["chamber light", '{"system":{"command":"ledctrl","led_node":"chamber_light","led_mode":"on"|"off",\u2026}}'],
        ["start print", '{"print":{"command":"project_file","url":"file:///sdcard/<f>.3mf","param":"Metadata/plate_1.gcode","use_ams":true,\u2026}}'],
    ], [1.5 * inch, 4.9 * inch])
    e += [P("Report fields read: gcode_state (RUNNING/PREPARE/PAUSE/IDLE/FINISH/FAILED), "
            "mc_percent, mc_remaining_time, layer_num/total_layer_num, subtask_name/gcode_file, "
            "temperatures and targets, cooling_fan_speed, spd_lvl_name, lights_report, AMS tray "
            "types/colors, and hms / print_error for the ERROR state."),
          Paragraph("02 \u00b7 CAMERA PROTOCOLS", S["h2"]), rule()]
    e += ref_table(["MODELS", "TRANSPORT", "CONSOLE RELAY"], [
        ["X1 / X1C / X1E / H2D", "RTSPS :322 \u2014 rtsps://bblp:<code>@<ip>:322/streaming/live/1. Requires LAN Mode Liveview.", "ffmpeg \u2192 MJPEG at configurable fps/width; served as multipart/x-mixed-replace."],
        ["A1 / A1 Mini / P1", "Proprietary chamber-image service, TLS :6000. 80-byte auth packet, then length-prefixed JPEG frames at ~1 fps.", "Frames pass straight through \u2014 no transcoding."],
    ], [1.2 * inch, 2.9 * inch, 2.3 * inch])
    e += [P("The relay hub enforces camera.max_streams (default 1); a new viewer evicts the "
            "oldest. The frame queue is depth-2 and drops stale frames so slow clients see the "
            "latest image rather than building latency."),
          Paragraph("03 \u00b7 FTPS + DISCOVERY", S["h2"]), rule(),
          P("<b>FTPS</b> \u2014 implicit TLS on port 990, user bblp. Lists .3mf/.gcode in the SD "
            "root (MLSD with NLST fallback) and uploads new files ahead of a project_file "
            "command."),
          P("<b>SSDP</b> \u2014 passive listener on UDP 2021 and 1990 for printer announcements, "
            "matching serial in USN and address in Location. On address change the MQTT client "
            "reconnects. If another app holds the port, discovery is skipped and configured IPs "
            "are used."),
          Paragraph("04 \u00b7 WEBSOCKET SCHEMA", S["h2"]), rule(),
          CODE('{ "type":"fleet", "version":123, "demo":false, "printers":[ {\n'
               '    "id":"voyager01","name":"VOYAGER-01","model":"X1 CARBON",\n'
               '    "state":"printing",             // idle|printing|paused|error|offline\n'
               '    "online":true,"camera":"rtsp",  // rtsp|chamber|demo|none\n'
               '    "file":"bracket_v3.3mf","percent":62,"remaining_min":107,\n'
               '    "layer":143,"total_layers":230,"nozzle":220,"nozzle_target":220,\n'
               '    "bed":65,"bed_target":65,"chamber":41,"fan":100,\n'
               '    "speed":"STANDARD","light":"on",\n'
               '    "ams":[{"type":"PLA","color":"#3fd8ff"},...],\n'
               '    "hms":[{"attr":...,"code":...}],"print_error":0 } ] }'),
          P("Client \u2192 server, acknowledged with {\"type\":\"ack\"} or {\"type\":\"error\"}:"),
          CODE('{ "type":"cmd", "id":"voyager01",\n'
               '  "action":"pause|resume|stop|light|start_print|refresh",\n'
               '  "on":true,          // light only\n'
               '  "file":"part.3mf" } // start_print only'),
          Paragraph("05 \u00b7 HTTP API", S["h2"]), rule()]
    e += ref_table(["ENDPOINT", "METHOD", "PURPOSE"], [
        ["/", "GET", "The console UI."],
        ["/ws", "GET", "WebSocket (schema above)."],
        ["/cam/<id>", "GET", "MJPEG stream for one printer."],
        ["/api/<id>/files", "GET", "JSON list of printable files on the SD card."],
        ["/api/<id>/upload", "POST", "Multipart upload of a .3mf/.gcode to the SD card."],
        ["/docs", "GET", "The Technical Archive."],
    ], [1.6 * inch, 0.8 * inch, 4.0 * inch])

    doc.build(e)
    print("wrote", out)


if __name__ == "__main__":
    build()
