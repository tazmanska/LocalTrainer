# Wdrożenie na Synology (https://trenazer.local)

Kontener na NAS (192.168.0.158) za reverse proxy DSM (nginx) z certyfikatem podpisanym przez własne lokalne CA. Nazwę `trenazer.local` ogłasza w sieci sama aplikacja przez mDNS (zmienne `MDNS_HOSTNAME` i `MDNS_IP` w stacku), więc Chromebook i inne urządzenia znajdą ją bez pliku `hosts`. Certyfikat obejmuje też adres IP, więc awaryjnie działa https://192.168.0.158 przez osobny wpis proxy (niżej).

Pliki:
- `release/trenazer-<wersja>.tar` – obraz Dockera
- `docker-compose.portainer.yml` – stack dla Portainera
- `certs/trenazer-ca.crt` i `certs/trenazer-ca.key` – lokalne CA (10 lat); urządzenia ufają tylko temu certyfikatowi, a klucz CA trzymaj wyłącznie u siebie (nie na NAS)
- `certs/trenazer.crt` i `certs/trenazer.key` – certyfikat serwera dla `DNS:trenazer.local` i `IP:192.168.0.158` podpisany przez CA (825 dni), dla DSM
- wszystko w `certs/` jest poza gitem

## 1. Katalog na dane
File Station: utwórz `/volume1/docker/trenazer/data` i wgraj tam **`certs/trenazer-ca.crt`** (tylko certyfikat CA, bez żadnego pliku `.key`). Aplikacja udostępnia go do pobrania w zakładce Profil, więc na Chromebooka i inne urządzenia nie trzeba go kopiować ręcznie. Aby przenieść dotychczasowe dane z PC, skopiuj tam też zawartość `D:\github\LocalTrainer\data` (`profile.json`, `workouts`, `history`).

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

NAS musi mieć stały adres 192.168.0.158 (rezerwacja DHCP w routerze albo statyczny IP w DSM); po zmianie adresu albo po wygaśnięciu certyfikatu serwera trzeba wystawić nowy z tego samego CA (niżej) i podmienić go w DSM. Urządzenia nie wymagają wtedy żadnych zmian.

Nowy certyfikat serwera (Git Bash w `certs/`):

```bash
export MSYS_NO_PATHCONV=1
openssl req -new -newkey rsa:2048 -nodes -keyout trenazer.key -out trenazer.csr -subj "/CN=trenazer.local"
printf "basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:trenazer.local,IP:192.168.0.158
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
" > leaf.ext
openssl x509 -req -in trenazer.csr -CA trenazer-ca.crt -CAkey trenazer-ca.key -CAcreateserial -days 825 -sha256 -extfile leaf.ext -out trenazer.crt
```

## 5. Zaufanie do certyfikatu na urządzeniach
Certyfikat pobiera się z samej aplikacji: zakładka **Profil → Certyfikat HTTPS → Pobierz certyfikat**, pod nim instrukcja dla Chromebooka, Windows i Androida (otwarta jest ta dla bieżącego urządzenia).

Przy pierwszym wejściu, zanim certyfikat jest zaufany, otwórz aplikację bez HTTPS pod **http://trenazer.local:3000** (port aplikacji na NAS) albo przejdź przez ostrzeżenie przeglądarki na https://trenazer.local. Po dodaniu certyfikatu do zaufanych zamknij kartę i otwórz **https://trenazer.local**: panel pokaże „Połączenie HTTPS jest zaufane”.

Jeśli urządzenie ufało wcześniej staremu certyfikatowi `trenazer.local` z własnym podpisem, usuń go z zaufanych i dodaj `trenazer-ca.crt`; Chrome odrzucał tamten certyfikat jako nieważny.

Chromebook szkolny lub firmowy (zarządzany) może blokować import certyfikatów; wtedy decyduje administrator.

## Inne urządzenia
- **Android (Chrome):** instrukcja w zakładce Profil; nazwa `trenazer.local` działa, jeśli system rozwiązuje mDNS, inaczej https://192.168.0.158:3443 (wpis awaryjny proxy).
- **iPhone/iPad:** Web Bluetooth nie działa w Safari ani w Chrome na iOS; aplikacja otworzy się, ale bez połączenia z trenażerem.

## Gdy trenazer.local się nie otwiera
- Logi kontenera w Portainerze: brak linii `mDNS: ogłaszam…` oznacza, że stack nie ma zmiennej `MDNS_HOSTNAME` albo działa bez `network_mode: host`.
- Na PC: `ping trenazer.local` powinien zwrócić 192.168.0.158.
- Jeśli nazwa się rozwiązuje, a strona nie działa, sprawdź wpis reverse proxy i przypisanie certyfikatu w DSM.
