# Bütçe, beklenenler ve çoklu işlem — 25 Ekim 2026

Yayın: https://atlas-pasam-v1.pages.dev/

Worker sürümü: `e5c40d18-8cde-47f4-81f9-0406a802b21c`.

0016_budgets, 0017_waiting ve 0018_multi geçişleri mevcut D1 veritabanına uygulandı. Ek ücretli servis, paket veya model eklenmedi. Masaüstü ortak bağlantısı yeniden başlatıldı.

- 539 otomatik test başarılı; yayın paketinin kuru çalıştırması başarılı.
- İmzalı önizleme, tam onay cümlesi, süre, eşzamanlı değişiklik ve tekrar onay kontrolleri doğrulandı.
- Çoklu işlem seçilen kayıtları tek atomik işlemle uygular. Desteklenen türler: not, görev, ajanda ve harcama. Bir kayıt başarısızsa tamamı geri alınır. Taslak 2–5 işlem içerir; seçimler başlangıçta kapalıdır.
- İzole RAM verileriyle Chrome üzerinde bütçe oluşturma, takip tarihiyle beklenen ekleme ve üç işlemden yalnızca ikisini seçme denendi. Seçilmeyen harcama bütçeye eklenmedi. 390×844 görünüm incelendi.
- Yayından sonra telefon adresi ve localhost üzerindeki 9 dosyanın kaynakla aynı olduğu, güvenlik başlıkları, anonim erişim engeli, geçersiz ay reddi, ortak veriler ve 14 gruplu yedek eşitliği doğrulandı.
- Üç özellik için bulutta taslak oluşturulup masaüstünden onaysız kayıt reddi sınandı. Üretimde test kaydı oluşturulmadı; kişisel veri grupları kontrol öncesi/sonrası aynı kaldı.
- Gerçek Android mikrofonu bu turda doğrudan sınanmadı. Mevcut ses altyapısı ve ücretsiz kotaları korunuyor. Beklenenler manuel takip listesidir; kargo sorgusu, mesaj gönderimi veya kapalı sayfada bildirim yapmaz.

Kanıt: `../../work/everyday-release-check.json`, `../../work/everyday-all-tests.log`.
Rehber: `../ATLAS-Butce-Beklenenler-Coklu-Islem.txt`.
