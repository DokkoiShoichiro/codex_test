let recipes=[];
let wakeLock=null;
let cookingModeActive=false;

const SUPABASE_URL='https://rddsbyawyhmihigbhbtj.supabase.co';
const SUPABASE_KEY='sb_publishable_Cj1yZyLDkZfIVb-LrUR7bw_VPe9VMJn';
const SUPABASE_TABLE='recipe_notes';
let sharedRecipeData={};

async function supabaseRequest(path,options={}){
  const headers={
    apikey:SUPABASE_KEY,
    'Content-Type':'application/json',
    ...(options.headers||{})
  };
  const response=await fetch(SUPABASE_URL+'/rest/v1/'+path,{
    ...options,
    headers
  });
  if(!response.ok){
    const body=await response.text();
    throw new Error('Supabase '+response.status+': '+body);
  }
  if(response.status===204) return null;
  const text=await response.text();
  return text?JSON.parse(text):null;
}
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
function getRating(id){return Number(sharedRecipeData[id]?.rating||0)}
function getNote(id){return sharedRecipeData[id]?.note||''}

async function loadSharedRecipeData(){
  try{
    const data=await supabaseRequest(
      SUPABASE_TABLE+'?select=recipe_id,rating,note,updated_at'
    );

    sharedRecipeData={};
    (data||[]).forEach(row=>{
      sharedRecipeData[row.recipe_id]={
        rating:Number(row.rating||0),
        note:row.note||''
      };
    });
    return true;
  }catch(error){
    console.error('Supabase read error:',error);
    return false;
  }
}

async function saveSharedRecipeData(id,{rating,note}){
  const current=sharedRecipeData[id]||{rating:0,note:''};
  const next={
    rating:rating===undefined?current.rating:Number(rating||0),
    note:note===undefined?current.note:String(note||'')
  };

  await supabaseRequest(
    SUPABASE_TABLE+'?on_conflict=recipe_id',
    {
      method:'POST',
      headers:{
        Prefer:'resolution=merge-duplicates,return=minimal'
      },
      body:JSON.stringify({
        recipe_id:id,
        rating:next.rating||null,
        note:next.note,
        updated_at:new Date().toISOString()
      })
    }
  );

  sharedRecipeData[id]=next;
}

async function migrateLocalDataIfNeeded(){
  for(const r of recipes){
    if(sharedRecipeData[r.id]) continue;

    const localRating=Number(localStorage.getItem(keyRating(r.id))||0);
    const localNote=localStorage.getItem(keyNote(r.id))||'';
    if(!localRating&&!localNote) continue;

    try{
      await saveSharedRecipeData(r.id,{rating:localRating,note:localNote});
    }catch(err){
      console.error('Local data migration failed:',r.id,err);
    }
  }
}

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
function buildImprovementSummary(r){
  const rating=getRating(r.id);
  const note=getNote(r.id);
  return (
    '<div class="improvement-card">'+
      '<p class="improvement-kicker">IMPROVEMENT DRAFT</p>'+
      '<h3>'+escapeHtml(r.title)+' の改善材料</h3>'+
      '<div class="improvement-meta">'+
        '<span>現在の評価：★ '+rating+' / 10</span>'+
        '<span>調理時間：約 '+r.minutes+' 分</span>'+
      '</div>'+
      '<section><h4>メモ</h4><p>'+(note?escapeHtml(note):'メモはまだありません。')+'</p></section>'+
      '<section><h4>材料</h4><ul>'+r.ingredients.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul></section>'+
      '<section><h4>下準備</h4><ol>'+r.prep.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ol></section>'+
      '<section><h4>調理手順</h4><ol>'+r.steps.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ol></section>'+
      '<section><h4>失敗しないポイント</h4><ul>'+r.points.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul></section>'+
      '<p class="improvement-note">次の段階で、この内容と評価・メモをAIに渡して改善案を生成できるようにします。</p>'+
    '</div>'
  );
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
        (rating>0 && rating<=7
          ? '<button class="improve-recipe-button" id="improveRecipe">このレシピを改善する</button>'
          : '')+
        '<div id="improvementPanel" class="improvement-panel" hidden></div>'+
      '</div>'+
    '</article>';

  setupCookingModeControls();
  els.content.querySelectorAll('[data-rating]').forEach(btn=>{
    btn.setAttribute('aria-pressed',String(Number(btn.dataset.rating)===rating));
    btn.addEventListener('click',async()=>{
      const newRating=Number(btn.dataset.rating);
      try{
        await saveSharedRecipeData(r.id,{rating:newRating});
        els.content.querySelectorAll('[data-rating]').forEach(option=>{
          const selected=Number(option.dataset.rating)===newRating;
          option.classList.toggle('active',selected);
          option.setAttribute('aria-pressed',String(selected));
        });
        els.content.querySelector('#detailRating').textContent='★ '+newRating+' / 10';
        render();
      }catch(err){
        console.error(err);
        alert('評価を保存できませんでした。\n'+err.message);
      }
    });
  });
  els.content.querySelector('#saveNote').addEventListener('click',async()=>{
    const b=els.content.querySelector('#saveNote');
    const note=els.content.querySelector('#memoArea').value;
    b.disabled=true;
    b.textContent='保存中…';
    try{
      await saveSharedRecipeData(r.id,{note});
      b.textContent='保存しました';
      setTimeout(()=>{b.textContent='メモを保存';b.disabled=false;},900);
    }catch(err){
      console.error(err);
      b.textContent='保存に失敗しました';
      b.disabled=false;
      alert('メモを保存できませんでした。\n'+err.message);
    }
  });
  const improveButton=els.content.querySelector('#improveRecipe');
  if(improveButton){
    improveButton.addEventListener('click',()=>{
      const panel=els.content.querySelector('#improvementPanel');
      panel.innerHTML=buildImprovementSummary(r);
      panel.hidden=false;
      panel.scrollIntoView({behavior:'smooth',block:'start'});
    });
  }

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

async function syncSharedData(){
  const cloudLoaded=await loadSharedRecipeData();
  if(!cloudLoaded) return;

  render();

  await migrateLocalDataIfNeeded();
  render();
}

async function initialize(){
  try{
    const response=await fetch('recipes.json?v=20260927-3',{cache:'no-store'});
    if(!response.ok) throw new Error('recipes.json: '+response.status);
    recipes=await response.json();

    fillSelect(els.genre,recipes.map(r=>r.genre));
    fillSelect(els.category,recipes.map(r=>r.category));
    renderLegend();

    // まずレシピ本体を即表示。共有データは後から反映する。
    render();
    syncSharedData();
  }catch(err){
    els.count.textContent='レシピデータの読み込みに失敗しました。';
    console.error(err);
  }
}

initialize();