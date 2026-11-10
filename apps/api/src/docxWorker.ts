import {createHash} from 'node:crypto';
import mammoth from 'mammoth';
import JSZip from 'jszip';
const chunks:Buffer[]=[];let size=0;
process.stdin.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>5*1024*1024)process.exit(1);chunks.push(chunk);});
process.stdin.on('end',async()=>{
 try {
  console.log=console.warn=console.error=console.info=console.debug=()=>{};
  const bytes=Buffer.concat(chunks);
  const archive=await JSZip.loadAsync(bytes);
  if(Object.keys(archive.files).length>1000 || !archive.file('word/document.xml') || Object.keys(archive.files).some(name=>/vbaProject|activeX|embeddings/i.test(name)))throw new Error('Unsupported DOCX');
  // Bound actual inflated bytes, not ZIP size claims, before the parser reads any XML.
  let inflated=0;
  for(const entry of Object.values(archive.files)){
   if(entry.dir)continue;
   await new Promise<void>((resolve,reject)=>{
    let size=0;const stream=entry.nodeStream('nodebuffer');
    stream.on('data',(chunk:Uint8Array)=>{size+=chunk.length;inflated+=chunk.length;if(size>10*1024*1024 || inflated>32*1024*1024){stream.pause();reject(new Error('Archive too large'));}});
    stream.on('error',reject);stream.on('end',resolve);stream.resume();
   });
  }
  const types=await archive.file('[Content_Types].xml')?.async('string');
  if(!types || types.length>100000 || !types.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') || /macroEnabled|vbaProject/i.test(types))throw new Error('Unsupported DOCX');
  // Raw text only: never render document HTML, execute macros, or fetch linked resources.
  const result=await mammoth.extractRawText({buffer:bytes});
  const text=result.value.trim();
  if(!text){process.stdout.write(JSON.stringify({ok:false,code:'DOCX_NO_EXTRACTABLE_TEXT'}));return;}
  if(text.length>40000){process.stdout.write(JSON.stringify({ok:false,code:'DOCX_TEXT_LIMIT'}));return;}
  process.stdout.write(JSON.stringify({ok:true,text,sourceFileSha256:createHash('sha256').update(bytes).digest('hex'),extraction:{engine:'mammoth',version:'1.11.0',readingOrder:'DOCUMENT_XML',offsetUnit:'UTF16_CODE_UNITS',ocr:false}}));
 } catch {process.stdout.write(JSON.stringify({ok:false,code:'INVALID_DOCX'}));}
});
