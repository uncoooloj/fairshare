/** Workers-native adapter for the route registration surface used by Fairshare.
 * No eval/code generation; business handlers and authorization remain unchanged.
 */
type Handler = (request: any, reply: any) => unknown;
type Route = { method: string; path: string; options: any; handler: Handler };
const allowedSchemaKeys = new Set(['type', 'properties', 'required', 'additionalProperties', 'enum', 'minLength', 'maxLength', 'pattern', 'anyOf']);
function checkSchema(schema: any): void {
  if(schema.type!==undefined && !['object','string','boolean','null'].includes(schema.type)) throw new Error('Unsupported route schema type');
  for (const key of Object.keys(schema)) if (!allowedSchemaKeys.has(key)) throw new Error(`Unsupported route schema keyword: ${key}`);
  for (const child of Object.values(schema.properties ?? {})) checkSchema(child);
  for (const child of schema.anyOf ?? []) checkSchema(child);
}
function valid(schema: any, value: any): boolean {
  if (schema.anyOf && !schema.anyOf.some((child: any) => valid(child, value))) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null' && value !== null) return false;
  if (schema.type === 'boolean' && typeof value !== 'boolean') return false;
  if (schema.type === 'string') {
    if (typeof value !== 'string') return false;
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) return false;
    if (schema.maxLength !== undefined && length > schema.maxLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return false;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const properties = schema.properties ?? {};
    if ((schema.required ?? []).some((key: string) => !Object.hasOwn(value, key))) return false;
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) { if (schema.additionalProperties === false) return false; }
      else if (!valid(properties[key], value[key])) return false;
    }
  }
  return true;
}
export default function workerRouter(defaults: { bodyLimit: number }) {
  const routes: Route[] = [];
  const hooks: Record<string, Handler[]> = {};
  let errorHandler: any;
  const app: any = {
    decorate(key: string, value: unknown) { if (Object.hasOwn(app, key)) throw new Error('Duplicate decoration'); app[key] = value; },
    addHook(name: string, handler: Handler) {
      if (!['onSend', 'onClose', 'preClose'].includes(name)) throw new Error(`Unsupported hook ${name}`);
      (hooks[name] ??= []).push(handler);
    },
    setErrorHandler(handler: unknown) { errorHandler = handler; },
    async close() { for (const name of ['preClose','onClose']) for (const hook of hooks[name] ?? []) await hook(undefined,undefined); },
    async inject(input: { method: string; url: string; headers?: Record<string,string>; payload?: Uint8Array; remoteAddress?: string }) {
      const url = new URL(input.url, 'https://internal.invalid');
      const parts = url.pathname.split('/');
      let params: Record<string,string> = {};
      const route = routes.find(candidate => {
        if (candidate.method !== input.method) return false;
        const template = candidate.path.split('/');
        if (template.length !== parts.length) return false;
        const extracted: Record<string,string> = {};
        for (let i=0;i<template.length;i++) {
          if (template[i].startsWith(':')) { if (!parts[i]) return false; extracted[template[i].slice(1)] = parts[i]; }
          else if (template[i] !== parts[i]) return false;
        }
        params = extracted; return true;
      });
      const headers = Object.fromEntries(Object.entries(input.headers ?? {}).map(([key,value])=>[key.toLowerCase(),value]));
      const req: any = { method:input.method, url:input.url, headers, params, query:Object.fromEntries(url.searchParams), ip:input.remoteAddress??'unknown', log:{error(){}} };
      let statusCode=200, result:unknown, sent=false;
      const responseHeaders: Record<string,string> = {};
      const reply: any = {
        code(code:number){statusCode=code;return reply;}, status(code:number){return reply.code(code);},
        header(key:string,value:string){responseHeaders[key.toLowerCase()]=String(value);return reply;},
        type(value:string){return reply.header('content-type',value);},
        send(value:unknown){result=value;sent=true;return reply;},
      };
      try {
        if (!route) { statusCode=404; result={error:{code:'NOT_FOUND',message:'Route not found.'}}; }
        else {
          for (const key of Object.keys(params)) params[key]=decodeURIComponent(params[key]);
          const bytes=input.payload??new Uint8Array();
          if (bytes.byteLength>(route.options.bodyLimit??defaults.bodyLimit)) throw Object.assign(new Error('Body too large'),{statusCode:413});
          if (bytes.byteLength) {
            if (headers['content-type']?.split(';')[0].trim()!=='application/json') throw Object.assign(new Error('JSON required'),{statusCode:415});
            try { req.body=JSON.parse(new TextDecoder().decode(bytes)); }
            catch { throw Object.assign(new Error('Invalid JSON'),{statusCode:400}); }
          }
          if (route.options.schema?.body && !valid(route.options.schema.body,req.body)) throw Object.assign(new Error('Invalid body'),{statusCode:400});
          const value=await route.handler(req,reply);
          if (!sent) result=value;
        }
      } catch(error) {
        if (error instanceof URIError) error=Object.assign(new Error('Invalid URL'),{statusCode:400});
        const value=await errorHandler(error,req,reply);
        if (!sent) result=value;
      }
      for(const hook of hooks.onSend??[]) await (hook as any)(req,reply,result);
      if (!responseHeaders['content-type']) responseHeaders['content-type']='application/json; charset=utf-8';
      const rawPayload=result instanceof Uint8Array ? result : new TextEncoder().encode(typeof result==='string'?result:JSON.stringify(result??null));
      return {statusCode,headers:responseHeaders,rawPayload};
    },
  };
  for(const method of ['GET','POST','PUT','PATCH','DELETE']) app[method.toLowerCase()]=(path:string,options:any,handler?:Handler)=>{
    if(typeof options==='function'){handler=options;options={};}
    if(options.schema?.body)checkSchema(options.schema.body);
    if(routes.some(route=>route.method===method&&route.path===path))throw new Error('Duplicate route');
    routes.push({method,path,options,handler:handler!});
    // Static paths must win over parameter routes, regardless of declaration order.
    routes.sort((a,b)=>a.path.split('/').filter(s=>s.startsWith(':')).length-b.path.split('/').filter(s=>s.startsWith(':')).length);
    return app;
  };
  return app;
}
