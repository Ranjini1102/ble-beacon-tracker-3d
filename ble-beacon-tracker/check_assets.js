var fs=require('fs');
var html=fs.readFileSync('index.html','utf8');
var refs=[];
var re1=/src="([^"]+)"/g, re2=/href="([^"]+\.css)"/g, m;
while((m=re1.exec(html))!==null){if(!m[1].startsWith('http'))refs.push(m[1]);}
while((m=re2.exec(html))!==null){if(!m[1].startsWith('http'))refs.push(m[1]);}
console.log('Checking '+refs.length+' asset references:');
refs.forEach(function(f){console.log((fs.existsSync(f)?'  OK  ':'  MISS')+'  '+f);});
