// Local-only browser harness; Google APIs are mocked, production data is never accessed.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const root=path.join(__dirname,'..');
http.createServer((req,res)=>{
 let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 html=html.replace(/<script[^>]+src=[^>]+><\/script>/g,'');
 html=html.replace('<head>','<head><script>'+fs.readFileSync(path.join(__dirname,'in-browser.js'),'utf8')+'</script>');
 html=html.replace("if('serviceWorker' in navigator && secure)","if(false)");
 res.setHeader('Content-Type','text/html');res.end(html);
}).listen(8766,'127.0.0.1',()=>console.log('Tests: http://127.0.0.1:8766'));
