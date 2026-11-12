# ATLAS V1 — Güvenlik ve test kaydı

Tarih: 24 Ekim 2026. Bu çalışma bağımsız bir sızma testi veya kusursuz güvenlik garantisi değildir.

## Doğrulananlar

- 31 Node.js testi geçti: doğru/yanlış şifre, HttpOnly/Secure/SameSite oturumu, imza bozulması, süre dolumu, parola rotasyonu, CSRF/Origin kontrolü, hız sınırı, gövde boyutu, rol enjeksiyonu, Gemini hata redaksiyonu, zaman aşımı, ücretsiz model kontrolü.
- Ses akışı testleri: açık onaydan önce mikrofon başlamaması, diktenin otomatik gönderilmemesi, Hey Atlas dışındaki sözlerin gönderilmemesi, uyandırma yanıtı, komut gönderme, durdurma, yazılı moda geçiş, arka plana geçiş ve izin hatasında durma. Bu testler sahte tarayıcı ses olayları kullanır.
- Tarayıcıda giriş, örnek sohbet, HTML enjeksiyonunun düz metin görünmesi, ses açıklaması ve mod geçişleri kontrol edildi.
- Masaüstü ve 390 piksel mobil genişlikte görsel kontrol yapıldı; yatay taşma yok.
- Cloudflare Wrangler dry-run derlemesi başarılı. Yerel Cloudflare çalışma ortamında ana sayfa 200, yapılandırılmamış API 503 ve gizli dosya isteği 404 döndü.
- Bağımlılık taramasında önce geliştirme aracının undici bağımlılığında 3 açık bulundu. undici 7.30.1 sürümüne sabitlendi; sonraki tarama 0 bilinen açık döndürdü. Lockfile pakete eklendi.
- Windows DPAPI sahte veriyle şifreleme/çözme testi geçti. Sistem güvenlik politikası değiştirilmedi; mevcut PowerShell 7 kullanıldı.
- Yerel kurulum yalnızca localhost Host ve Origin değerlerini kabul eder. Rastgele kurulum bağlantısı ve HttpOnly kurulum çerezi gerektirir; kurulum tamamlanınca tekrar yapılandırma kapalıdır.
- Windows hizmeti 127.0.0.1:8790 üzerinde başladı. Açılış kısayolu ve masaüstü bağlantıları oluşturuldu. Gerçek Windows yeniden başlatma testi yapılmadı.

## Koruma tasarımı

Gerçek anahtar kaynak koda, ön yüze, URL’ye veya test çıktısına eklenmez. Gemini isteğinde anahtar sunucu tarafında HTTP başlığıyla gönderilir. Mesajlar sunucuda kalıcı kaydedilmez, içerik loglanmaz. Ön yüzde model çıktısı textContent ile gösterilir; HTML veya betik çalıştırılmaz. Haricî font/izleme betiği yoktur. Eksik güvenlik ayarları erişimi kapatır. Worker sadece izinli statik dosyaları sunar.

## Açık kalan doğrulamalar

1. Gerçek Gemini anahtarı doğrulandı. AI Studio proje ekranında Free tier görüldü. Eski model yeni hesaplara kapalı olduğundan ücretsiz katmanda sunulan gemini-3.5-flash-lite modeline geçildi. Gerçek arayüzden gönderilen kısa bağlantı testine başarılı yanıt alındı. Ücretli plan etkinleştirilmedi.
2. Kullanıcı 24 Ekim 2026 tarihinde Windows Chrome üzerinde Hey Atlas denemesinde sesli yanıt aldığını doğruladı. Uygulama içi tarayıcıda ses tanıma hatası yaşandı; kesin hata nedeni doğrulanmadı. Mikrofon, hizmet erişimi, ağ ve dil hataları için ayrı açıklamalar eklendi. Uzun süreli dinleme kararlılığı ve farklı ortamların doğruluğu henüz ölçülmedi.
3. Android gerçek cihaz testi ve ana ekrana ekleme henüz yapılmadı. Telefon için HTTPS yayın adresi henüz yok.
4. Kullanıcının açık onayıyla 24 Ekim 2026 tarihinde atlas-bulut-v1.nova-ai-studio.workers.dev adresine Workers Free planında yayınlandı. Cloudflare dağıtımı Ready durumunda. SESSION_SECRET oluşturuldu; Gemini anahtarı ve erişim parolası için güvenli panel kullanıcıya bırakıldı. Bu bilgisayardan HTTPS bağlantısı ECONNRESET ile kesildi; uçtan uca bulut kontrolü ve Android testi henüz tamamlanmadı.
5. Web sürümü arka planda/ekran kilitliyken sürekli dinleme garantisi vermez. Ön plandan ayrıldığında uygulama bilerek dinlemeyi durdurur.
6. Cloudflare limitleri yaklaşık/bölgeseldir; dağıtık saldırıya karşı mutlak koruma veya sıfır maliyet garantisi değildir. Ücretsiz hesap ayarları ayrıca kontrol edilmelidir.
7. Windows aynı kullanıcı hesabıyla çalışan kötü amaçlı yazılım DPAPI içeriğini çözebilir. Yerel şifreli depo bu tehdit için güvenlik sınırı değildir.

Para harcama, dışarıya mesaj gönderme veya kullanıcı verisi silme işlemi yapılmadı. Yayın kullanıcının açık onayıyla gerçekleştirildi. Sesli/yazılı sohbet dışında eylem gerçekleştiren araçlar yoktur.




## Son yayın doğrulaması — 24 Ekim 2026

Kullanıcının yeni adres için açık onayıyla https://atlas-pasam-v1.pages.dev/ yayınlandı. Önceki açık maddelerden bulut yapılandırması tamamlandı: üç sır Worker üzerinde mevcut (değerler okunmadan adları doğrulandı). Pages service binding üzerinden aynı Worker'a bağlanıyor; sırlar Pages'e kopyalanmadı. Chrome'da ATLAS giriş ekranı açıldı. HTTP kontrolleri: ana sayfa 200, oturum authenticated:false ve ready:true, gizli dosya yolu 404, oturumsuz sohbet 401, farklı Origin ile giriş 403. Kimliği doğrulanmış bulut Gemini yanıtı ve gerçek Android Hey Atlas denemesi henüz tamamlanmadı. Pages giriş bağlantısı için eklenen 2 test geçti (önceden geçen 31 temel teste ek olarak). Hesabın ortak workers.dev alt alan adı ve diğer projeleri değiştirilmedi.

## Android kullanıcı doğrulaması — 24 Ekim 2026

Kullanıcı, https://atlas-pasam-v1.pages.dev/ adresini Android Chrome'da açıp giriş yapma, Hey Atlas ile uyandırma ve kısa sesli sohbet denemesi yönergelerinden sonra “Sesli sohbet çalıştı” yanıtını verdi. Android uçtan uca sesli sohbet kullanıcı tarafından doğrulandı. Bu doğrulama fiziksel cihazın otomatik ölçümü değildir; uzun süreli kararlılık, farklı cihazlar, arka plan ve kilit ekranı desteğini doğrulamaz. Ana ekrana ekleme henüz kullanıcı tarafından doğrulanmadı.

## Yerel konuşma üslubu güncellemesi

Hitap Komutanım olarak değiştirildi. Model yönergesi varsayılan olarak 1–3 kısa, gündelik cümle; kullanıcı detay istediğinde daha kapsamlı açıklama verecek şekilde düzenlendi. Uyandırma yanıtı ve ekran metinleri güncellendi. 33 otomatik test ve Wrangler dry-run başarılı. Yerel hizmet yeniden başlatıldı. Bu değişiklik henüz buluta yayınlanmadı; gerçek model üslubu ve cihazda ses tonu ayrıca kullanıcıyla denenmelidir. Cihazın yerel Türkçe ses motoru değiştirilmedi.

## Dairesel görünüm ve konuşma üslubu yayını — 24 Ekim 2026

Kullanıcının açık onayıyla Worker sürümü 46b0eb73-1195-4867-b163-11f4d577c257 yayınlandı. Büyük dairesel RGB animasyonu, durumlara göre hareket, azaltılmış hareket tercihi, Komutanım hitabı ve varsayılan 1–3 kısa doğal cümle yönergesi yayına alındı. https://atlas-pasam-v1.pages.dev/ üzerinden index.html, app.js ve style.css HTTP 200 döndü ve yerel son dosyalarla birebir eşleşti. Oturum kontrolünde ready:true, authenticated:false; oturumsuz sohbet 401. Gizli ayarlar korundu. Son üslubun gerçek Gemini yanıtıyla ve güncel animasyonun fiziksel telefonda yeniden denenmesi bu yayın kontrolünde yapılmadı; önceki Android sesli sohbet kullanıcı doğrulaması geçerlidir. Cihazın yerel ses motoru değişmedi.

## Doğal ses yayını — 24 Ekim 2026

Kullanıcının açık yayın onayıyla seçilen Algieba sesi ve tok/sakin üslup bilgisayar ve bulut sürümüne eklendi. Son Worker sürümü: f55f3c6d-e094-43fd-90f3-4ff418b45f8b. 40 test geçti: önceki güvenlik kontrolleri, ses için oturum/Origin/uzunluk/kota denetimleri, hata redaksiyonu, üretimde sabit ücretsiz model, geç gelen sesin durdurmadan sonra çalmaması ve yazılı moda geçişte sesin durması dahil.

Yerel gerçek ses isteği 200/audio-wav döndü. Bulutta ilk deneme istek oluşturma uyumsuzluğuyla başarısız oldu; Workers uyumlu AbortController zaman aşımı ve yönlendirmeleri izlemeyen manual modu ile düzeltildi. Son gerçek uçtan uca kontrolde giriş 200, Gemini sohbet 200 (“Merhaba Komutanım, nasılsınız?”), doğal ses 200 ve geçerli 134754 bayt WAV doğrulandı. Hem localhost hem pages.dev üzerinde yeni ses istemcisi ve hazır uyandırma kaydı 200/audio-wav; oturumsuz ses isteği 401. Geçici teşhis başlıkları kaldırıldı.

Ses modeli gemini-3.8-flash-lite-tts; ses Algieba. Ücretli plana/model geçişi veya otomatik yeniden deneme yok. 600 karakter, 2 MiB ses, 3 MiB sağlayıcı yanıtı, 40 saniye ve dakikada 6 ses isteği sınırları var. Uzun yanıtın ilk bölümü seslendirilir, tamamı metinde kalır. Gemini ücretsiz hesap kotaları geçerlidir; sınırsız ücretsiz kullanım iddia edilmez. Model yanıt metni doğal ses üretimi için Google'a gönderilir; arayüz açıklaması güncellendi. API anahtarı istemciye gönderilmez. Yeni sesin fiziksel Android hoparlöründe duyulması ve tarayıcı oynatma izni kullanıcı tarafından ayrıca doğrulanmalıdır; önceki cihaz ses testi eski motorla yapılmıştı.
Android doğal ses kullanıcı doğrulaması: Kullanıcı telefonda yeni sesin çalıştığını ve daha doğal olduğunu bildirdi. Bilgisayardaki sorun ayrıca inceleniyor.
Bilgisayar doğal ses kullanıcı doğrulaması: Eski 8787 demo sunucusunda voice-wake.wav isteği 404 Sayfa bulunamadı döndü; gerçek 8790 sunucusunda 200/audio-wav doğrulandı. Kullanıcı Chrome üzerinde http://localhost:8790/ adresinden yeniden giriş yapıp Hey Atlas denemesinden sonra Evet, şimdi çalıştı yanıtını verdi. Doğal ses artık Android ve bilgisayarda kullanıcı tarafından doğrulandı.
