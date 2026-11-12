// Accept printable token formats, including newer Gemini authorization keys.
// Authenticity and provider permissions are verified by Gemini, not by a prefix.
export function validateSetup(body) {
  if (typeof body?.key !== 'string' || !/^[\x21-\x7E]{20,4096}$/.test(body.key))
    return 'API anahtarı eksik veya biçimi geçersiz. Tam anahtarı boşluk olmadan kopyalayın.';
  if (typeof body.password !== 'string' || body.password.length < 20)
    return 'ATLAS şifresi en az 20 karakter olmalı. İki şifre alanını da güncelleyin.';
  if (body.password.length > 512) return 'ATLAS şifresi en fazla 512 karakter olabilir.';
  if (body.freeTier !== true) return 'Ücretsiz katman ve kapalı faturalandırma kutusunu işaretleyin.';
  return null;
}
