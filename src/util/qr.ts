import QRCode from 'qrcode';

/** Render text (a wallet address) to a PNG QR code buffer. */
export async function addressQr(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type: 'png',
    margin: 1,
    width: 320,
    errorCorrectionLevel: 'M',
  });
}
