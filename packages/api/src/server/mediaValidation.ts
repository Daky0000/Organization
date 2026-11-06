export function validateRasterDataUrl(url: string,declaredType: string): Buffer {
  const match=url.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match || match[1]!==declaredType) throw new Error('Image content does not match its declared type');
  const bytes=Buffer.from(match[2],'base64');
  if (!bytes.length || bytes.length>10*1024*1024) throw new Error('Image must be between 1 byte and 10MB');
  const valid=declaredType==='image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
    declaredType==='image/jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255 :
    bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP';
  if (!valid) throw new Error('The file is not a supported raster image');
  return bytes;
}
