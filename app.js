let recipes=[];
const els={
  q:document.querySelector('#q'),
  genre:document.querySelector('#genre'),
  category:document.querySelector('#category'),
  minutes:document.querySelector('#minutes'),
  rating:document.querySelector('#rating'),
  sort:document.querySelector('#sort'),
  list:document.querySelector('#recipeList'),
  count:document.querySelector('#count'),
  clear:document.querySelector('#clearFilters'),
  dialog:document.querySelector('#recipeDialog'),
  content:document.querySelector('#dialogContent'),
  close:document.querySelector('#closeDialog'),
  totalRecipes:document.querySelector('#totalRecipes'),
  ratedRecipes:document.querySelector('#ratedRecipes'),
  topRated:document.querySelector('#topRated')
};

function keyRating(id){return 'recipe-rating:'+id}
function keyNote(id){return 'recipe-note:'+id}
function getRating(id){return Number(localStorage.getItem(keyRating(id))||0)}
function getNote(id){return localStorage.getItem(keyNote(id))||''}

function fillSelect(el,values){
  [...new Set(values)].sort().forEach(v=>{
    const o=document.createElement('option');
    o.value=v;o.textContent=v;el.appendChild(o);
  });
}
function normalize(s){return String(s||'').toLowerCase().replace(/\s+/g,'')}
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}
function matches(r){
  const q=normalize(els.q.value);
  const hay=normalize([
    r.title,r.genre,r.category,r.summary,
    ...(r.ingredients_tags||[]),...(r.feature_tags||[]),...(r.ingredients||[])
  ].join(' '));
  if(q&&!hay.includes(q))return false;
  if(els.genre.value&&r.genre!==els.genre.value)return false;
  if(els.category.value&&r.category!==els.category.value)return false;
  if(els.minutes.value&&Number(r.minutes)>Number(els.minutes.value))return false;
  if(els.rating.value){
    const rt=getRating(r.id);
    if(els.rating.value==='unrated'){
      if(rt!==0)return false;
    }else if(rt<Number(els.rating.value))return false;
  }
  return true;
}
function renderStats(){
  const ratings=recipes.map(r=>getRating(r.id)).filter(Boolean);
  els.totalRecipes.textContent=recipes.length;
  els.ratedRecipes.textContent=ratings.length;
  els.topRated.textContent=ratings.length?Math.max(...ratings):'–';
}
function render(){
  let list=recipes.filter(matches);
  if(els.sort.value==='rating'){
    list.sort((a,b)=>getRating(b.id)-getRating(a.id)||a.title.localeCompare(b.title,'ja'));
  }else if(els.sort.value==='minutes'){
    list.sort((a,b)=>Number(a.minutes)-Number(b.minutes)||a.title.localeCompare(b.title,'ja'));
  }else{
    list.sort((a,b)=>a.title.localeCompare(b.title,'ja'));
  }

  els.count.textContent=list.length+' / '+recipes.length+' 件';
  els.list.innerHTML='';

  list.forEach(r=>{
    const rating=getRating(r.id);
    const card=document.createElement('article');
    card.className='card';
    card.tabIndex=0;
    card.innerHTML=
      '<div class="card-top">'+
        '<span class="category-badge">'+escapeHtml(r.category)+'</span>'+
        '<span class="time-badge">約 '+r.minutes+' 分</span>'+
      '</div>'+
      '<h3>'+escapeHtml(r.title)+'</h3>'+
      '<p class="card-summary">'+escapeHtml(r.summary)+'</p>'+
      '<div class="tags">'+
        (r.ingredients_tags||[]).slice(0,4).map(t=>'<span class="tag">'+escapeHtml(t)+'</span>').join('')+
      '</div>'+
      '<div class="card-footer">'+
        '<span class="genre-label">'+escapeHtml(r.genre)+'</span>'+
        '<span class="rating-line '+(rating?'':'unrated')+'">'+(rating?'★ '+rating+' / 10':'NOT RATED')+'</span>'+
      '</div>';

    const open=()=>openRecipe(r);
    card.addEventListener('click',open);
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
    els.list.appendChild(card);
  });
  renderStats();
}

function section(title,body,cls=''){
  return '<section class="detail-section '+cls+'"><h3>'+title+'</h3>'+body+'</section>';
}
function openRecipe(r){
  const rating=getRating(r.id),note=getNote(r.id);

  els.content.innerHTML=
    '<article class="detail">'+
      '<header class="detail-header">'+
        '<p class="detail-kicker">'+escapeHtml(r.genre).toUpperCase()+' / '+escapeHtml(r.category).toUpperCase()+'</p>'+
        '<h2>'+escapeHtml(r.title)+'</h2>'+
        '<div class="detail-meta">'+
          '<span>約 '+r.minutes+' 分</span>'+
          '<span>'+escapeHtml(r.servings)+'</span>'+
          '<span>'+(rating?'★ '+rating+' / 10':'未評価')+'</span>'+
        '</div>'+
        '<p class="summary">'+escapeHtml(r.summary)+'</p>'+
      '</header>'+
      section('材料','<ul class="ingredients-list">'+r.ingredients.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>')+
      section('下準備','<ol>'+r.prep.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ol>')+
      section('調理手順','<ol>'+r.steps.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ol>')+
      section('失敗しないポイント','<ul>'+r.points.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>')+
      section('追加すると美味しい食材・アレンジ','<ul>'+r.arrangements.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>')+
      '<div class="userbox">'+
        '<h3>自分の評価・メモ</h3>'+
        '<div class="stars">'+Array.from({length:10},(_,i)=>{const n=i+1;return '<button data-rating="'+n+'" class="'+(rating===n?'active':'')+'">★'+n+'</button>'}).join('')+'</div>'+
        '<textarea id="memoArea" placeholder="次回変えたい点、家族の反応、分量調整など">'+escapeHtml(note)+'</textarea>'+
        '<button class="save-note" id="saveNote">メモを保存</button>'+
      '</div>'+
    '</article>';

  els.content.querySelectorAll('[data-rating]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      localStorage.setItem(keyRating(r.id),btn.dataset.rating);
      openRecipe(r);
      render();
    });
  });
  els.content.querySelector('#saveNote').addEventListener('click',()=>{
    localStorage.setItem(keyNote(r.id),els.content.querySelector('#memoArea').value);
    const b=els.content.querySelector('#saveNote');
    b.textContent='保存しました';
    setTimeout(()=>b.textContent='メモを保存',900);
  });
  if(!els.dialog.open)els.dialog.showModal();
}

['input','change'].forEach(evt=>{
  [els.q,els.genre,els.category,els.minutes,els.rating,els.sort].forEach(el=>{
    el.addEventListener(evt,render);
  });
});
els.clear.addEventListener('click',()=>{
  els.q.value='';
  els.genre.value='';
  els.category.value='';
  els.minutes.value='';
  els.rating.value='';
  els.sort.value='title';
  render();
});
els.close.addEventListener('click',()=>els.dialog.close());
els.dialog.addEventListener('click',e=>{if(e.target===els.dialog)els.dialog.close()});

fetch('recipes.json')
  .then(r=>r.json())
  .then(data=>{
    recipes=data;
    fillSelect(els.genre,recipes.map(r=>r.genre));
    fillSelect(els.category,recipes.map(r=>r.category));
    render();
  })
  .catch(err=>{
    els.count.textContent='recipes.json の読み込みに失敗しました。';
    console.error(err);
  });