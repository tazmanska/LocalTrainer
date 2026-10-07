# Wdrożenie na Synology (https://trenazer.local)

Kontener na NAS (192.168.0.158) za reverse proxy DSM (nginx) z certyfikatem z własnym podpisem, jak `esphome.local`. Nazwę `trenazer.local` ogłasza w sieci sama aplikacja przez mDNS (zmienne `MDNS_HOSTNAME` i `MDNS_IP` w stacku), więc Chromebook i inne urządzenia znajdą ją bez pliku `hosts`. Certyfikat obejmuje też adres IP, więc awaryjnie działa https://192.168.0.158 przez osobny wpis proxy (niżej).

Pliki:
- `release/trenazer-<wersja>.tar` – obraz Dockera
- `docker-compose.portainer.yml` – stack dla Portainera
- `certs/trenazer.crt` i `certs/trenazer.key` – certyfikat (10 lat) dla `IP:192.168.0.158` i `DNS:trenazer.local`, poza gitem; klucz prywatny trzymaj tylko u siebie i na NAS

## 1. Katalog na dane
File Station: utwórz `/volume1/docker/trenazer/data`. Aby przenieść dotychczasowe dane z PC, skopiuj tam zawartość `D:\github\LocalTrainer\data` (`profile.json`, `workouts`, `history`).

## 2. Obraz i kontener (Portainer, http://192.168.0.158:9000)
1. Images → Import → wybierz `release/trenazer-<wersja>.tar`.
2. Stacks → Add stack → nazwa `trenazer` → Web editor → wklej `docker-compose.portainer.yml` → Deploy.
3. Sprawdź: http://192.168.0.158:3000 powinno pokazać aplikację, a w logach kontenera powinna być linia `mDNS: ogłaszam trenazer.local → 192.168.0.158`.

Aktualizacja: zaimportuj nowy `.tar`, a w stacku kliknij „Update the stack” (obraz `trenazer:latest`); dane w `/volume1/docker/trenazer/data` zostają.

## 3. Certyfikat w DSM
Panel sterowania → Zabezpieczenia → Certyfikat → Dodaj → „Importuj certyfikat”:
- Klucz prywatny: `trenazer.key`
- Certyfikat: `trenazer.crt`
- Certyfikat pośredni: puste

## 4. Reverse proxy w DSM
Panel sterowania → Portal logowania → Zaawansowane → Odwrotny serwer proxy → Utwórz:
- Nazwa: `trenazer`
- Źródło: protokół **HTTPS**, nazwa hosta **trenazer.local**, port **443**
- Miejsce docelowe: protokół **HTTP**, nazwa hosta **localhost**, port **3000**

Potem Zabezpieczenia → Certyfikat → Ustawienia → przy usłudze `trenazer.local` wybierz certyfikat `trenazer.local`.

Awaryjnie, gdyby mDNS nie działał: drugi wpis ze źródłem HTTPS, nazwa hosta `*`, port `3443`, ten sam cel i certyfikat; adres https://192.168.0.158:3443.

NAS musi mieć stały adres 192.168.0.158 (rezerwacja DHCP w routerze albo statyczny IP w DSM); po zmianie adresu trzeba wygenerować nowy certyfikat.

## 5. Chromebook
1. Skopiuj `trenazer.crt` na Chromebooka (np. przez Dysk Google albo pendrive).
2. Ustawienia → Prywatność i bezpieczeństwo → Bezpieczeństwo → Zarządzaj certyfikatami → **Urzędy certyfikacji** → Importuj → wybierz `trenazer.crt` → zaznacz **„Ufaj temu certyfikatowi przy identyfikowaniu stron internetowych”**.
3. Otwórz https://trenazer.local. Kłódka bez ostrzeżenia oznacza, że Bluetooth zadziała.

Chromebook szkolny lub firmowy (zarządzany) może blokować import certyfikatów; wtedy decyduje administrator.

## 6. Komputer z Windows (opcjonalnie)
1. Dwuklik na `trenazer.crt` → Zainstaluj certyfikat → Komputer lokalny → „Umieść wszystkie certyfikaty w następującym magazynie” → **Zaufane główne urzędy certyfikacji**.
2. Otwórz https://trenazer.local (Windows rozwiązuje nazwy `.local` przez mDNS, wpis w `hosts` nie jest potrzebny).

## Inne urządzenia
- **Android (Chrome):** certyfikat: Ustawienia → Zabezpieczenia → Szyfrowanie i dane logowania → Zainstaluj certyfikat → Certyfikat CA; adres jak na Chromebooku.
- **iPhone/iPad:** Web Bluetooth nie działa w Safari ani w Chrome na iOS; aplikacja otworzy się, ale bez połączenia z trenażerem.

## Gdy trenazer.local się nie otwiera
- Logi kontenera w Portainerze: brak linii `mDNS: ogłaszam…` oznacza, że stack nie ma zmiennej `MDNS_HOSTNAME` albo działa bez `network_mode: host`.
- Na PC: `ping trenazer.local` powinien zwrócić 192.168.0.158.
- Jeśli nazwa się rozwiązuje, a strona nie działa, sprawdź wpis reverse proxy i przypisanie certyfikatu w DSM.
