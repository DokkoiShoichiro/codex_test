let recipes=[];
let wakeLock=null;
let cookingModeActive=false;
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
  topRated:document.querySelector('#topRated'),
  genreLegend:document.querySelector('#genreLegend'),
  searchButton:document.querySelector('#searchButton')
};

const GENRE_META={
  '和食':{icon:'和', className:'genre-wa', label:'和食'},
  '洋食':{icon:'洋', className:'genre-yo', label:'洋食'},
  '中華':{icon:'中', className:'genre-chu', label:'中華'},
  '沖縄風':{icon:'沖', className:'genre-oki', label:'沖縄風'}
};

function getGenreMeta(genre){
  return GENRE_META[genre] || {icon:'他', className:'genre-other', label:genre||'その他'};
}
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
function renderLegend(){
  const usedGenres=[...new Set(recipes.map(r=>r.genre))];
  els.genreLegend.innerHTML='';
  usedGenres.forEach(genre=>{
    const meta=getGenreMeta(genre);
    const chip=document.createElement('button');
    chip.type='button';
    chip.className='legend-chip'+(els.genre.value===genre?' active':'');
    chip.dataset.genre=genre;
    chip.innerHTML='<span class="legend-icon '+meta.className+'">'+meta.icon+'</span><span>'+escapeHtml(meta.label)+'</span>';
    chip.addEventListener('click',()=>{
      els.genre.value = els.genre.value===genre ? '' : genre;
      renderLegend();
      render();
    });
    els.genreLegend.appendChild(chip);
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
    const meta=getGenreMeta(r.genre);
    const card=document.createElement('article');
    card.className='card '+meta.className;
    card.tabIndex=0;
    card.innerHTML=
      '<div class="card-top">'+
        '<span class="category-badge">'+escapeHtml(r.category)+'</span>'+
        '<span class="time-badge">約 '+r.minutes+' 分</span>'+
      '</div>'+
      '<span class="genre-pill"><span class="genre-icon">'+meta.icon+'</span>'+escapeHtml(meta.label)+'</span>'+
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
  const meta=getGenreMeta(r.genre);

  els.content.innerHTML=
    '<article class="detail '+meta.className+'">'+
      '<header class="detail-header">'+
        '<div class="detail-genre-row">'+
          '<span class="genre-pill"><span class="genre-icon">'+meta.icon+'</span>'+escapeHtml(meta.label)+'</span>'+
          '<p class="detail-kicker">'+escapeHtml(r.category).toUpperCase()+'</p>'+
        '</div>'+
        '<h2 id="recipeTitle">'+escapeHtml(r.title)+'</h2>'+
        '<div class="detail-meta">'+
          '<span>約 '+r.minutes+' 分</span>'+
          '<span>'+escapeHtml(r.servings)+'</span>'+
          '<span id="detailRating" aria-live="polite">'+(rating?'★ '+rating+' / 10':'未評価')+'</span>'+
        '</div>'+
        '<p class="summary">'+escapeHtml(r.summary)+'</p>'+
        '<div class="cooking-toolbar">'+
          '<button id="cookingModeButton" class="cooking-mode-button" type="button">🍳 料理モード ON</button>'+
          '<span id="cookingModeStatus" class="cooking-mode-status">画面の自動スリープを防ぎます</span>'+
        '</div>'+
      '</header>'+
      '<div class="recipe-body"><div class="recipe-materials">'+
      section('材料','<ul class="ingredients-list">'+r.ingredients.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>')+
      '</div><div class="recipe-method">'+
      section('下準備','<ol>'+r.prep.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ol>')+
      section('調理手順','<ol>'+r.steps.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ol>')+
      section('失敗しないポイント','<ul>'+r.points.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>')+
      section('追加すると美味しい食材・アレンジ','<ul>'+r.arrangements.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>')+
      '</div></div>'+
      '<div class="userbox">'+
        '<h3>自分の評価・メモ</h3>'+
        '<div class="stars">'+Array.from({length:10},(_,i)=>{const n=i+1;return '<button data-rating="'+n+'" class="'+(rating===n?'active':'')+'">★'+n+'</button>'}).join('')+'</div>'+
        '<textarea id="memoArea" placeholder="次回変えたい点、家族の反応、分量調整など">'+escapeHtml(note)+'</textarea>'+
        '<button class="save-note" id="saveNote">メモを保存</button>'+
      '</div>'+
    '</article>';

  setupCookingModeControls();
  els.content.querySelectorAll('[data-rating]').forEach(btn=>{
    btn.setAttribute('aria-pressed',String(Number(btn.dataset.rating)===rating));
    btn.addEventListener('click',()=>{
      localStorage.setItem(keyRating(r.id),btn.dataset.rating);
      els.content.querySelectorAll('[data-rating]').forEach(option=>{
        const selected=option.dataset.rating===btn.dataset.rating;
        option.classList.toggle('active',selected);
        option.setAttribute('aria-pressed',String(selected));
      });
      els.content.querySelector('#detailRating').textContent='★ '+btn.dataset.rating+' / 10';
      render();
    });
  });
  els.content.querySelector('#saveNote').addEventListener('click',()=>{
    localStorage.setItem(keyNote(r.id),els.content.querySelector('#memoArea').value);
    const b=els.content.querySelector('#saveNote');
    b.textContent='保存しました';
    setTimeout(()=>b.textContent='メモを保存',900);
  });
  if(!els.dialog.open){els.dialog.showModal();els.dialog.scrollTop=0;}
}

els.q.addEventListener('input',render);
els.q.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();render();els.q.blur();}
});
els.searchButton.addEventListener('click',()=>{render();els.q.blur();});
[els.genre,els.category,els.minutes,els.rating,els.sort].forEach(el=>{
  el.addEventListener('change',()=>{
    if(el===els.genre) renderLegend();
    render();
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
els.dialog.addEventListener('close',()=>disableCookingMode());

async function enableCookingMode(){
  const button=els.content.querySelector('#cookingModeButton');
  const status=els.content.querySelector('#cookingModeStatus');
  if(!('wakeLock' in navigator)){
    if(status){status.textContent='このブラウザは料理モードに対応していません';status.classList.add('error');}
    return;
  }
  try{
    wakeLock=await navigator.wakeLock.request('screen');
    cookingModeActive=true;
    if(button){button.classList.add('active');button.textContent='🍳 料理モード OFF';}
    if(status){status.textContent='料理モード中：画面をスリープさせません';status.classList.remove('error');}
    wakeLock.addEventListener('release',()=>{
      wakeLock=null;
      if(cookingModeActive && document.visibilityState==='visible') reacquireWakeLock();
    },{once:true});
  }catch(err){
    cookingModeActive=false;
    if(status){status.textContent='料理モードを開始できませんでした';status.classList.add('error');}
  }
}

async function reacquireWakeLock(){
  if(!cookingModeActive || document.visibilityState!=='visible' || wakeLock) return;
  try{
    wakeLock=await navigator.wakeLock.request('screen');
    const button=els.content.querySelector('#cookingModeButton');
    const status=els.content.querySelector('#cookingModeStatus');
    if(button){button.classList.add('active');button.textContent='🍳 料理モード OFF';}
    if(status){status.textContent='料理モード中：画面をスリープさせません';status.classList.remove('error');}
    wakeLock.addEventListener('release',()=>{wakeLock=null;},{once:true});
  }catch(err){}
}

async function disableCookingMode(){
  cookingModeActive=false;
  if(wakeLock){
    try{await wakeLock.release();}catch(err){}
    wakeLock=null;
  }
  const button=els.content.querySelector('#cookingModeButton');
  const status=els.content.querySelector('#cookingModeStatus');
  if(button){button.classList.remove('active');button.textContent='🍳 料理モード ON';}
  if(status){status.textContent='画面の自動スリープを防ぎます';status.classList.remove('error');}
}

function setupCookingModeControls(){
  const button=els.content.querySelector('#cookingModeButton');
  const status=els.content.querySelector('#cookingModeStatus');
  if(!button) return;
  if(!('wakeLock' in navigator) && status){
    status.textContent='このブラウザは料理モードに対応していません';
    status.classList.add('error');
    button.disabled=true;
  }
  button.addEventListener('click',()=>{
    if(cookingModeActive) disableCookingMode();
    else enableCookingMode();
  });
}

document.addEventListener('visibilitychange',()=>{
  if(cookingModeActive && document.visibilityState==='visible') reacquireWakeLock();
});

fetch('recipes.json')
  .then(r=>r.json())
  .then(data=>{
    recipes=data;
    fillSelect(els.genre,recipes.map(r=>r.genre));
    fillSelect(els.category,recipes.map(r=>r.category));
    renderLegend();
    render();
  })
  .catch(err=>{
    els.count.textContent='recipes.json の読み込みに失敗しました。';
    console.error(err);
  });