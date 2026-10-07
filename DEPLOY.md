# Wdrożenie na Synology (https://trenazer.local)

Tak samo jak `esphome.local`, `zigbee.local` i `traccar.local`: kontener na NAS (192.168.0.158), reverse proxy DSM (nginx) z certyfikatem z własnym podpisem, wpis w `hosts` i certyfikat dodany do zaufanych.

Pliki:
- `release/trenazer-<wersja>.tar` – obraz Dockera
- `docker-compose.portainer.yml` – stack dla Portainera
- `certs/trenazer.local.crt` i `certs/trenazer.local.key` – certyfikat (10 lat), poza gitem; klucz prywatny trzymaj tylko u siebie i na NAS

## 1. Katalog na dane
File Station: utwórz `/volume1/docker/trenazer/data`. Aby przenieść dotychczasowe dane z PC, skopiuj tam zawartość `D:\github\LocalTrainer\data` (`profile.json`, `workouts`, `history`).

## 2. Obraz i kontener (Portainer, http://192.168.0.158:9000)
1. Images → Import → wybierz `release/trenazer-<wersja>.tar`.
2. Stacks → Add stack → nazwa `trenazer` → Web editor → wklej `docker-compose.portainer.yml` → Deploy.
3. Sprawdź: http://192.168.0.158:3000 powinno pokazać aplikację.

Aktualizacja: zaimportuj nowy `.tar`, a w stacku kliknij „Update the stack” (obraz `trenazer:latest`); dane w `/volume1/docker/trenazer/data` zostają.

## 3. Certyfikat w DSM
Panel sterowania → Zabezpieczenia → Certyfikat → Dodaj → „Importuj certyfikat”:
- Klucz prywatny: `trenazer.local.key`
- Certyfikat: `trenazer.local.crt`
- Certyfikat pośredni: puste

## 4. Reverse proxy w DSM
Panel sterowania → Portal logowania → Zaawansowane → Odwrotny serwer proxy → Utwórz:
- Nazwa: `trenazer`
- Źródło: protokół **HTTPS**, nazwa hosta **trenazer.local**, port **443**
- Miejsce docelowe: protokół **HTTP**, nazwa hosta **localhost**, port **3000**

Potem Zabezpieczenia → Certyfikat → Ustawienia → przy usłudze `trenazer.local` wybierz certyfikat `trenazer.local`.

## 5. Komputer z Windows
1. Jako administrator dopisz do `C:\Windows\System32\drivers\etc\hosts`:
   ```
   192.168.0.158   trenazer.local
   ```
2. Dwuklik na `trenazer.local.crt` → Zainstaluj certyfikat → Komputer lokalny → „Umieść wszystkie certyfikaty w następującym magazynie” → **Zaufane główne urzędy certyfikacji**.
3. Zamknij wszystkie okna Chrome/Edge i otwórz https://trenazer.local (kłódka bez ostrzeżenia = Bluetooth zadziała).

## Inne urządzenia
- **Android (Chrome):** certyfikat: Ustawienia → Zabezpieczenia → Szyfrowanie i dane logowania → Zainstaluj certyfikat → Certyfikat CA. Nazwa `trenazer.local` wymaga wpisu w DNS routera (Android bez roota nie ma pliku hosts).
- **iPhone/iPad:** Web Bluetooth nie działa w Safari ani w Chrome na iOS; aplikacja otworzy się, ale bez połączenia z trenażerem.
