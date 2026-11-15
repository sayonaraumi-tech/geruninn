const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
function createStaticServer(root){
  return http.createServer((req,res)=>{
    try{
      const u=new URL(req.url,'http://localhost').pathname;
      const file=path.join(root,u==='/'?'index.html':u);
      const ext=path.extname(file);
      const types={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
      res.setHeader('Content-Type',types[ext]||'application/octet-stream');
      res.end(fs.readFileSync(file));
    }catch{res.writeHead(404).end();}
  });
}
module.exports={createStaticServer};
