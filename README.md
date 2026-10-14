# tenantree für Claude Code

tenantree verbindet Claude Code mit der SAP Business Technology Platform (SAP BTP) Ihres Unternehmens: Landschaften wählen, Anmeldung am eigenen SAP Cloud Identity Services (IAS), Administration der BTP-Dienste mit Freigabe durch Menschen und lückenlosem Protokoll.

Dieses Repository ist der Plugin-Marketplace von tenantree. Es enthält keine kundenspezifische Konfiguration; welche Landschaften Sie sehen, legt Ihr Unternehmen im Tenantree-Portal fest.

## Voraussetzungen

- Claude Code in einer aktuellen Version (`claude --version`); Installation: https://code.claude.com/docs/en/setup
- Ein Zugang zum Tenantree-Portal: https://portal.tenantree.de (Anfrage über https://tenantree.de/kontakt.html)

## Installation

```
claude plugin marketplace add tenantree-de/claude-plugin
claude plugin install tenantree@tenantree
```

Alternativ in einer laufenden Claude-Code-Sitzung:

```
/plugin marketplace add tenantree-de/claude-plugin
/plugin install tenantree@tenantree
```

Danach Claude Code neu starten, `/mcp` aufrufen, den Server `tenantree` auswählen und die Anmeldung starten.

## Aktualisieren

```
claude plugin marketplace update tenantree
claude plugin update tenantree@tenantree
```

## Einrichtung

Die vollständige Einrichtung (SAP Cloud Identity Services, Anwendung „tenantree“, Gruppen, Portal) beschreibt die Anleitung im Portal. Eine Kontextdatei, mit der ein KI-Assistent Sie Schritt für Schritt durch die Einrichtung führt: https://portal.tenantree.de/tenantree-einrichtung-kontext.md

## Was das Plugin enthält

- MCP-Server `tenantree` (https://portal.tenantree.de/mcp) mit Anmeldung per OAuth
- Skill mit den Arbeitsregeln (genau ein aktives Ziel, Bestätigung vor Änderungen an Produktionssystemen, keine Geheimnisse im Chat)
- Anzeige des aktiven Ziels (Organisation, Landschaft, System, Region, Berechtigung) über der Eingabezeile

## Kontakt und Rechtliches

Sandner Consulting, Inh. Jonathan Sandner · kontakt@tenantree.de · [Impressum](https://tenantree.de/impressum.html) · [Datenschutz](https://tenantree.de/datenschutz.html)

Die Nutzung von tenantree setzt einen Vertrag mit Sandner Consulting voraus. Siehe LICENSE.
