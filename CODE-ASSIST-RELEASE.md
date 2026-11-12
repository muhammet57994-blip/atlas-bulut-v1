ATLAS Kodlama Yardımcısı — Canlı Yayın
Doğrulama tarihi: 2026-11-08

Canlı adres: https://atlas-pasam-v1.pages.dev
Cloudflare Worker sürümü: b49b15f3-f0fc-4ce7-ac3a-53fe3b0ba803
Pages deployment: 9d0c975e-6c7e-4a55-9af5-8aec4c33cfa2

Yayımlananlar
- Kodlama modunda Markdown kod blokları güvenli biçimde ayrı gösterilir.
- Kod yalnızca kullanıcı kopyala düğmesine basarsa panoya yazılır.
- Clipboard desteklenmiyorsa görünür hata bildirimi gelir.
- Worker, code-assist.js ve code-assist.css dosyalarını izinli statik dosya listesine ekler.
- Kodlama yanıt yönergesi gerçek dosya içeriği sağlandığında diff, doğrulama ve geri alma adımlarını ister; dosya erişimi/çalıştırma yapıldığını iddia etmez.
- Araştırma alıntısı kaynak eşlemesi önceki yayında düzeltildi; sağlayıcı kotası nedeniyle canlı araştırma işlevi bu turda sonuç vermedi.
- Yedek önizlemesi sayım grupları artık Türkçe, anlaşılır başlıklarla gösterilir; dosya yerel kalır.
- Otomatik “Atlas” beklemesi varsayılan kapalıdır; yalnızca cihazda açıkça seçilen tercih otomatik mikrofonu etkinleştirir. Ayrıntılar: [VOICE-PRIVACY-RELEASE.md](VOICE-PRIVACY-RELEASE.md).
- Ana ekran durum rozeti, uyandırma düğmesi, araç menüsü kartları ve kısa pencere yerleşimi görsel olarak iyileştirildi. Ayrıntılar: [VISUAL-RELEASE-2026-11-08.md](VISUAL-RELEASE-2026-11-08.md).

Canlı kontroller
- GET /: 200 HTML
- GET /api/session: 200 JSON (oturum kapalı, servis hazır)
- POST /api/chat, oturumsuz: 401 (beklenen erişim koruması)
- GET /code-assist.js: 200 JavaScript
- GET /code-assist.css: 200 CSS
- GET /organize.js: 200 JavaScript; Türkçe yedek grubu adları mevcut.
- GET /app.js: 200 JavaScript; otomatik dinleme varsayılanı kapalı.
- GET /style.css: 200 CSS; yeni durum rozeti ve dar pencere düzeni canlıda doğrulandı.
- GET /experience.css: 200 CSS; simgeli araç kartları Chrome’da görsel olarak doğrulandı.
- Worker ve Pages dağıtımından sonra API yönlendirmesi ve kod asistanı dosyaları doğrulandı.

Testler
- Kod yardımcısı ve araştırma yönlendirmesi hedef testleri: 7/7 geçti.
- Yedekleme güvenlik testleri: 11/11 geçti; dışa aktarma salt okunur ve izinli alanlarla sınırlıdır.
- 2026-11-08 itibarıyla tam test paketi 563/563 geçti; kod yardımcısının önceki hedef kapsamı 7/7 idi.
- Bilinen bağımlılık denetimi: önceki denetimde bilinen açık yoktu.

Sınırlar
- Gerçek Android mikrofon testi kullanıcı isteğiyle atlandı.
- Canlı Gemini Research sağlayıcı kota sınırı nedeniyle yanıt vermedi.
- Bu sürümde yedek geri yükleme desteklenmiyor; üretim verisine dokunulmadı.
- Ayrı yayımlanan salt okunur yedek önizlemesi: [BACKUP-PREVIEW-RELEASE.md](BACKUP-PREVIEW-RELEASE.md).

