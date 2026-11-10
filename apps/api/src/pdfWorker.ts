/** Untrusted PDF parsing subprocess. Never print document text to stderr or application logs. */
import { createHash } from 'node:crypto';
const MAX_BYTES=5*1024*1024,MAX_PAGES=20,MAX_CHARS=40000;
const respond=(value:unknown)=>process.stdout.write(JSON.stringify(value));
let chunks:Buffer[]=[];let size=0;
try {
 for await(const chunk of process.stdin){size+=chunk.length;if(size>MAX_BYTES)throw new Error('PDF_TOO_LARGE');chunks.push(Buffer.from(chunk));}
 const bytes=Buffer.concat(chunks);chunks=[];
 if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw new Error('INVALID_PDF');
 // Warnings may contain source content. Suppress all parser console output; protocol uses stdout directly.
 console.log=console.warn=console.error=console.info=console.debug=()=>{};
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,enableXfa:false,stopAtErrors:true,verbosity:0,maxImageSize:0,disableAutoFetch:true,disableStream:true});
 let doc;try{doc=await task.promise;}catch(e){throw new Error((e as {name?:string})?.name==='PasswordException'?'PDF_PASSWORD_REQUIRED':'INVALID_PDF');}
 try {
  if(doc.numPages<1||doc.numPages>MAX_PAGES)throw new Error('PDF_PAGE_LIMIT');
  let text='';const pages:Array<{page:number;start:number;end:number}>=[];
  for(let pageNo=1;pageNo<=doc.numPages;pageNo++){
   const page=await doc.getPage(pageNo);const content=await page.getTextContent({disableNormalization:false});const start=text.length;
   for(const item of content.items){if(!('str' in item))continue;const str=item.str.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');if(text.length+str.length+1>MAX_CHARS)throw new Error('PDF_TEXT_LIMIT');text+=str;text+=item.hasEOL?'\n':' ';}
   // Offsets index the exact persisted UTF-16 text, not raw PDF bytes or screenshot geometry.
   pages.push({page:pageNo,start,end:text.length});if(pageNo<doc.numPages){if(text.length+2>MAX_CHARS)throw new Error('PDF_TEXT_LIMIT');text+='\n\n';}page.cleanup();
  }
  if(!text.trim())throw new Error('PDF_NO_EXTRACTABLE_TEXT');
  respond({ok:true,text,pages,sourceFileSha256:createHash('sha256').update(bytes).digest('hex'),extraction:{engine:'pdfjs-dist',version:'5.4.624',readingOrder:'PDF_TEXT_LAYER',offsetUnit:'UTF16_CODE_UNITS',ocr:false}});
 }finally{await doc.destroy();}
}catch(e){const allowed=new Set(['PDF_TOO_LARGE','INVALID_PDF','PDF_PASSWORD_REQUIRED','PDF_PAGE_LIMIT','PDF_TEXT_LIMIT','PDF_NO_EXTRACTABLE_TEXT']);const code=e instanceof Error&&allowed.has(e.message)?e.message:'PDF_EXTRACTION_FAILED';respond({ok:false,code});}
