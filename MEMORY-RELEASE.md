# ATLAS ortak hafıza — yayına hazırlık

Durum (24 Ekim 2026): Kullanıcının açık onayıyla yayınlandı. D1 atlas-memory oluşturuldu ve MEMORY_DB bağlantısı kuruldu. Worker sürümü a9a4200c-7da6-4d2e-a313-03b87ba06a23. Mevcut giriş adresi https://atlas-pasam-v1.pages.dev/ korunuyor. Bilgisayarda ortak bağlantı etkinleştirildi ve sunucu yeniden başlatıldı. Ücretli plan veya ödeme işlemi yapılmadı.

Yayın sonrası: Pages adresinde ve localhost:8790 üzerinde oturum açma, hafıza listeleme ve onaysız komutun yalnızca taslak üretmesi canlı testte geçti; test hiçbir kayıt yazmadı. Bilgisayar köprüsünde Node tarafından açılmış sıkıştırılmış yanıtın başlıkları düzeltildi; 45 otomatik test geçti. Kullanıcıyla iki fiziksel cihazda kayıt ekleme/görme denemesi bekleniyor.

## Kullanım

“Bunu hatırla: Çayımı şekersiz içerim” deyin veya yazın. ATLAS metni gösterir; yalnızca Kaydet onayından sonra ortak hafızaya ekler. Normal konuşma kayıt oluşturmaz. “Hafızam” kayıtları gösterir. Silmek için ilgili kaydı seçip ayrıca onaylayın. En fazla 30 kayıt, kayıt başına 400 karakter desteklenir; aynı bilgi tekrar eklenmez.

Hitap Efendim olarak güncellendi. Uyanma ses dosyası da yeni hitapla üretildi. Kayıtlar yanıt bağlamı olarak Gemini’ye gönderilir; şifre, API anahtarı veya hassas sırlar hafızaya yazılmamalıdır. Sohbet geçmişi bu özellik tarafından saklanmaz. Silinen kayıt yeni yanıtların hafıza bağlamından çıkarılır; önceden açık konuşmada yazılmış metinler kendiliğinden temizlenmez. Cloudflare Free D1 kurtarma geçmişinde silinmiş veriler 7 güne kadar kalabilir.

## Onay sonrası yayın sırası

1. Cloudflare hesabının Workers Free olduğunu ve Gemini faturalandırmasının kapalı olduğunu yeniden doğrula. Ücretli plana geçme.
2. Proje dizininde `node node_modules/wrangler/bin/wrangler.js d1 create atlas-memory` ile boş veritabanı oluştur. Dönen gerçek database_id değerini kullanarak wrangler.jsonc içine d1_databases dizisini ekle: binding MEMORY_DB, database_name atlas-memory, database_id gerçek UUID, migrations_dir migrations. Sahte kimlik kullanma.
3. `node node_modules/wrangler/bin/wrangler.js d1 migrations apply atlas-memory --remote` ile şemayı uygula. Var olan verileri silme.
4. `node --test test/*.test.js` ve `node node_modules/wrangler/bin/wrangler.js deploy --dry-run` kontrollerini yap; ardından onaylı Worker sürümünü deploy et. Pages girişinin ATLAS service binding'i aynı Worker'a yönlendiği için mevcut Pages adresi korunur.
5. pages.dev üzerinden giriş ve hafıza listeleme işlemlerini doğrula. Kullanıcının izni olmadan kişisel test kaydı ekleme/silme. Gerçek kayıt denemesini kullanıcıyla yap.
6. Bilgisayarda %LOCALAPPDATA%/ATLAS/cloud-memory.json dosyasına {"enabled":true} yaz, yalnızca ATLAS local.mjs sunucusunu yeniden başlat. Bu bayrak bütün yerel /api isteklerini sabit HTTPS Pages adresine aktarır. Böylece bilgisayar ve telefon aynı erişim şifresini, aynı bulut oturum altyapısını ve aynı hafızayı kullanır. Ayrı bir yerel hafıza kopyası yoktur. Bağlantı yokken kayıt başarılı gösterilmez.
7. Kullanıcı bilgisayar ve telefonda yeniden giriş yapıp bir kayıt eklesin; diğer cihazda Hafızam listesini yenileyerek kontrol etsin.

Free D1 sınırı aşılırsa sorgular durur; ücretli plana otomatik geçiş yapılmaz. Resmî kaynaklar: https://developers.cloudflare.com/d1/platform/pricing/ ve https://developers.cloudflare.com/d1/platform/limits/ .

## Test kapsamı

44 test geçti: gerçek bellek içi SQLite şemasıyla kayıt, tekrar kontrolü, 30 kayıt sınırı, SQL parametreleri, açık komut ve kayıt onayı, yetkisiz erişim ve yabancı Origin reddi, iki oturumda ortak hafıza, onaylı silme ve eski kayıt uyuşmazlığı, silinen bilginin yeni bağlamdan çıkarılması, eksik veritabanında kapalı davranış, bilgisayar köprüsünde sabit hedef ve yönlendirme reddi. Mevcut sohbet, oturum, ses ve Pages testleri de geçti. Cloudflare üzerinde canlı D1 ve iki fiziksel cihaz testi yayın sonrasına kaldı.
