# Pick – Weniger grübeln. Mehr machen.

Private PWA für iPhone und Android: eure Lieblingsgerichte, Restaurants und Lieferdienste
als Karten mit Fotos. Nach rechts wischen = machen wir, nach links = nö. Mit Supabase habt ihr auf beiden Handys
denselben Stand.

## Einrichtung

### 1. Supabase-Projekt anlegen
1. Auf [supabase.com](https://supabase.com) kostenlos registrieren → **New project**.
2. Name z. B. `pick`, Region **Frankfurt (eu-central-1)**, ein Datenbank-Passwort vergeben (gut aufheben, braucht die App nicht).

### 2. Tabellen anlegen
1. Links **SQL Editor** → **New query**.
2. Inhalt von [`supabase/setup.sql`](supabase/setup.sql) einfügen → **Run**. Es sollte „Success“ erscheinen.

### 3. Eure zwei Zugänge anlegen
1. Links **Authentication → Users → Add user → Create new user**.
2. E-Mail + Passwort eintragen, Haken bei **Auto Confirm User** → anlegen.
3. Das Gleiche für den zweiten Zugang.

### 4. Fremde Anmeldungen sperren
**Authentication → Sign In / Providers** → **Allow new users to sign up** ausschalten → Speichern.
Damit kommen nur eure zwei Zugänge an die Daten.

### 5. Schlüssel in die App eintragen
1. **Project Settings → API Keys**: den **Publishable key** (`sb_publishable_…`) kopieren.
   (Falls dort nur die alten Keys stehen: den **anon public** Key nehmen.)
2. Die **Project URL** (`https://xxxx.supabase.co`) steht unter **Project Settings → Data API** bzw. auf der Projekt-Startseite.
3. Beides in [`config.js`](config.js) eintragen und committen.

Der Publishable Key ist dafür gedacht, öffentlich im Browser zu liegen. Geschützt sind die Daten
über den Login und die Row-Level-Security-Regeln aus `setup.sql`. Den **secret / service_role** Key
niemals hier eintragen.

### 6. App online stellen (GitHub Pages)
Im Repo: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`** → Save.
Nach ca. 1 Minute läuft die App unter `https://nmekow.github.io/pwa-app/`.

### 7. Aufs Handy holen und anmelden
- **iPhone:** Link in **Safari** öffnen → Teilen-Symbol → **Zum Home-Bildschirm**.
- **Android:** Link in **Chrome** öffnen → Menü ⋮ → **App installieren**.
- Beim ersten Öffnen erscheint die Startseite: mit einem eurer zwei Zugänge anmelden. Die Anmeldung bleibt gespeichert.
- Ohne Anmeldung sieht niemand die App – nur die Startseite.

Wer sich zuerst anmeldet, lädt seine Einträge hoch. Beim zweiten Handy werden die Beispiel-Einträge
automatisch verworfen, wenn auf dem Server schon Daten liegen.

## Was die App kann
- **Heute**: Startseite mit „Jetzt dran“ (je nach Uhrzeit Essen, nächste Aufgabe oder Einkauf) und allen Helfern als Kacheln
- **Essen**: Kochen / Auswärts / 🎲 Zufall als Kartenstapel – rechts = machen wir, links = nö (max. 2× am Tag);
  Karte antippen zeigt Rezept bzw. Adresse, Karte und Öffnungszeiten
- **Einkauf**: gemeinsame Liste im Bring-Stil, Zutaten direkt aus Rezepten übernehmen
- **Aufgaben**: immer eine Karte „als Nächstes“ mit Erledigt / Später / Timer, Zuweisung an euch, Wiederholung
- **Alle**: alle Helfer, eure Namen, Sync, Sicherung
- Termine, Routinen und Freizeit sind als „bald“ vorgemerkt

## Wie der Sync funktioniert
- Alles wird zuerst lokal gespeichert, die App funktioniert also auch offline.
- Synchronisiert wird beim Öffnen der App, kurz nach jeder Änderung und alle 30 Sekunden, solange sie offen ist.
- Bei Konflikten gewinnt die zuletzt geänderte Version eines Eintrags.
- Fotos werden beim Hinzufügen verkleinert (ca. 100–300 KB) und in der Tabelle `images` geteilt.
  Das kostenlose Supabase-Paket (500 MB Datenbank) reicht damit für weit über tausend Fotos.

## Hinweise
- Kostenlose Supabase-Projekte werden nach ca. einer Woche ohne Zugriff pausiert. Bei regelmäßiger
  Nutzung passiert das nicht; sonst im Supabase-Dashboard auf **Restore project** klicken.
- Nach Änderungen an den App-Dateien in `sw.js` die `VERSION` hochzählen, damit die Handys die neue Version laden.
