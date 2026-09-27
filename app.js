let recipes=[];
let wakeLock=null;
let cookingModeActive=false;

const SUPABASE_URL='https://rddsbyawyhmihigbhbtj.supabase.co';
const SUPABASE_KEY='sb_publishable_Cj1yZyLDkZfIVb-LrUR7bw_VPe9VMJn';
const SUPABASE_TABLE='recipe_notes';
const RECIPE_VERSIONS_TABLE='recipe_versions';
let sharedRecipeData={};
let recipeVersions={};

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
  searchButton:document.querySelector('#searchButton'),
  trashButton:document.querySelector('#trashButton')
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
      SUPABASE_TABLE+'?select=recipe_id,rating,note,deleted,updated_at'
    );

    sharedRecipeData={};
    (data||[]).forEach(row=>{
      sharedRecipeData[row.recipe_id]={
        rating:Number(row.rating||0),
        note:row.note||'',
        deleted:Boolean(row.deleted)
      };
    });
    return true;
  }catch(error){
    console.error('Supabase read error:',error);
    return false;
  }
}

async function saveSharedRecipeData(id,{rating,note}){
  const current=sharedRecipeData[id]||{rating:0,note:'',deleted:false};
  const next={
    rating:rating===undefined?current.rating:Number(rating||0),
    note:note===undefined?current.note:String(note||''),
    deleted:current.deleted||false
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
        deleted:next.deleted,
        updated_at:new Date().toISOString()
      })
    }
  );

  sharedRecipeData[id]=next;
  syncCurrentVersionFeedback(id);
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

async function loadRecipeVersions(){
  try{
    const data=await supabaseRequest(
      RECIPE_VERSIONS_TABLE+'?select=recipe_id,version,recipe_data,rating,note,created_at&order=recipe_id.asc,version.asc'
    );
    recipeVersions={};
    (data||[]).forEach(row=>{
      if(!recipeVersions[row.recipe_id]) recipeVersions[row.recipe_id]=[];
      recipeVersions[row.recipe_id].push(row);
    });
    return true;
  }catch(error){
    console.error('Version read error:',error);
    return false;
  }
}

function getVersions(id){
  return recipeVersions[id]||[];
}

function getCurrentVersion(id){
  const versions=getVersions(id);
  const cloudVersion=versions.length ? Math.max(...versions.map(v=>Number(v.version)||1)) : 1;
  const base=recipes.find(r=>r.id===id);
  const baseVersion=Math.max(1,Number(base?.version)||1);
  return Math.max(cloudVersion,baseVersion);
}

function getLatestVersionRow(id){
  const versions=getVersions(id);
  if(!versions.length) return null;
  return versions.reduce((latest,row)=>
    Number(row.version)>Number(latest.version)?row:latest
  ,versions[0]);
}

function getVersionRow(id,version){
  return getVersions(id).find(v=>Number(v.version)===Number(version))||null;
}

async function bootstrapRecipeVersions(){
  const rows=[];
  const upgradedIds=[];

  recipes.forEach(r=>{
    const versions=getVersions(r.id);
    const baseVersion=Math.max(1,Number(r.version)||1);
    const latestVersion=versions.length
      ? Math.max(...versions.map(v=>Number(v.version)||1))
      : 0;

    if(baseVersion>latestVersion){
      rows.push({
        recipe_id:r.id,
        version:baseVersion,
        recipe_data:r,
        rating:latestVersion===0 ? (getRating(r.id)||null) : null,
        note:latestVersion===0 ? (getNote(r.id)||'') : ''
      });
      if(latestVersion>0) upgradedIds.push(r.id);
    }
  });

  if(!rows.length) return;

  await supabaseRequest(
    RECIPE_VERSIONS_TABLE,
    {
      method:'POST',
      headers:{Prefer:'return=minimal'},
      body:JSON.stringify(rows)
    }
  );

  rows.forEach(row=>{
    if(!recipeVersions[row.recipe_id]) recipeVersions[row.recipe_id]=[];
    recipeVersions[row.recipe_id].push({
      ...row,
      created_at:new Date().toISOString()
    });
  });

  for(const id of upgradedIds){
    await supabaseRequest(
      SUPABASE_TABLE+'?on_conflict=recipe_id',
      {
        method:'POST',
        headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
        body:JSON.stringify({
          recipe_id:id,
          rating:null,
          note:'',
          deleted:Boolean(sharedRecipeData[id]?.deleted),
          updated_at:new Date().toISOString()
        })
      }
    );
    sharedRecipeData[id]={
      ...(sharedRecipeData[id]||{}),
      rating:0,
      note:''
    };
  }
}

function applyLatestVersions(){
  recipes=recipes.map(base=>{
    const latest=getLatestVersionRow(base.id);
    if(!latest || !latest.recipe_data) return base;
    const baseVersion=Math.max(1,Number(base.version)||1);
    const cloudVersion=Math.max(1,Number(latest.version)||1);
    if(cloudVersion<baseVersion) return base;
    return {...base,...latest.recipe_data,id:base.id};
  });
}

async function syncCurrentVersionFeedback(id){
  const version=getCurrentVersion(id);
  const current=sharedRecipeData[id]||{rating:0,note:''};
  try{
    await supabaseRequest(
      RECIPE_VERSIONS_TABLE+
      '?recipe_id=eq.'+encodeURIComponent(id)+
      '&version=eq.'+encodeURIComponent(version),
      {
        method:'PATCH',
        headers:{Prefer:'return=minimal'},
        body:JSON.stringify({
          rating:current.rating||null,
          note:current.note||''
        })
      }
    );
    const row=getVersionRow(id,version);
    if(row){
      row.rating=current.rating||null;
      row.note=current.note||'';
    }
  }catch(error){
    console.error('Version feedback sync error:',error);
  }
}

async function setRecipeDeleted(id,deleted){
  const current=sharedRecipeData[id]||{rating:0,note:'',deleted:false};
  const next={...current,deleted:Boolean(deleted)};

  await supabaseRequest(
    SUPABASE_TABLE+'?on_conflict=recipe_id',
    {
      method:'POST',
      headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
      body:JSON.stringify({
        recipe_id:id,
        rating:next.rating||null,
        note:next.note||'',
        deleted:next.deleted,
        updated_at:new Date().toISOString()
      })
    }
  );

  sharedRecipeData[id]=next;
}

function isDeleted(id){
  return Boolean(sharedRecipeData[id]?.deleted);
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
  els.totalRecipes.textContent=recipes.filter(r=>!isDeleted(r.id)).length;
  els.ratedRecipes.textContent=ratings.length;
  els.topRated.textContent=ratings.length?Math.max(...ratings):'–';
}
function render(){
  let list=recipes.filter(r=>!isDeleted(r.id)).filter(matches);
  if(els.sort.value==='rating'){
    list.sort((a,b)=>getRating(b.id)-getRating(a.id)||a.title.localeCompare(b.title,'ja'));
  }else if(els.sort.value==='minutes'){
    list.sort((a,b)=>Number(a.minutes)-Number(b.minutes)||a.title.localeCompare(b.title,'ja'));
  }else{
    list.sort((a,b)=>a.title.localeCompare(b.title,'ja'));
  }

  const activeCount=recipes.filter(r=>!isDeleted(r.id)).length;
  els.count.textContent=list.length+' / '+activeCount+' 件';
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
        '<span class="time-badge">約 '+r.minutes+' 分 · ver.'+getCurrentVersion(r.id)+'</span>'+
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
function buildImprovementPrompt(r){
  const rating=getRating(r.id);
  const note=getNote(r.id);
  return [
    'このレシピを改善してください。',
    '',
    '【改善方針】',
    '現在の評価とメモを最重要情報として、家庭で作りやすい範囲で改良してください。',
    '辛味を強くせず、味はぼやけないようにしてください。',
    '分量・切り方・下処理を明記してください。',
    '変更した点と、その理由も最後にまとめてください。',
    '',
    '【料理名】',
    r.title,
    '',
    '【現在のバージョン】',
    'ver.'+getCurrentVersion(r.id),
    'このレシピを元に、次の ver.'+(getCurrentVersion(r.id)+1)+' を作る前提で改善してください。',
    '',
    '【現在の評価】',
    '★ '+rating+' / 10',
    '',
    '【メモ】',
    note || 'なし',
    '',
    '【材料】',
    ...r.ingredients.map(x=>'・'+x),
    '',
    '【下準備】',
    ...r.prep.map((x,i)=>(i+1)+'. '+x),
    '',
    '【調理手順】',
    ...r.steps.map((x,i)=>(i+1)+'. '+x),
    '',
    '【失敗しないポイント】',
    ...r.points.map(x=>'・'+x)
  ].join('\n');
}

function buildImprovementSummary(r){
  const rating=getRating(r.id);
  const note=getNote(r.id);
  const prompt=buildImprovementPrompt(r);
  return (
    '<div class="improvement-card">'+
      '<p class="improvement-kicker">IMPROVEMENT PROMPT</p>'+
      '<h3>'+escapeHtml(r.title)+' の改善依頼</h3>'+
      '<div class="improvement-meta">'+
        '<span>現在の評価：★ '+rating+' / 10</span>'+
        '<span>調理時間：約 '+r.minutes+' 分</span>'+
      '</div>'+
      '<section><h4>メモ</h4><p>'+(note?escapeHtml(note):'メモはまだありません。')+'</p></section>'+
      '<textarea id="improvementPrompt" class="improvement-prompt" readonly>'+escapeHtml(prompt)+'</textarea>'+
      '<div class="improvement-actions">'+
        '<button id="copyImprovementPrompt" class="copy-improvement-button" type="button">ChatGPT用の改善依頼をコピー</button>'+
      '</div>'+
      '<p class="improvement-note">コピーした内容をこのChatGPTに貼れば、改善版レシピを作れます。</p>'+
    '</div>'
  );
}

function renderHistoricalVersion(r,versionRow){
  const vr=versionRow.recipe_data||r;
  const meta=getGenreMeta(vr.genre||r.genre);
  const rating=Number(versionRow.rating||0);
  const note=versionRow.note||'';

  els.content.innerHTML=
    '<article class="detail '+meta.className+' historical-version">'+
      '<header class="detail-header">'+
        '<div class="detail-genre-row">'+
          '<span class="genre-pill"><span class="genre-icon">'+meta.icon+'</span>'+escapeHtml(meta.label)+'</span>'+
          '<p class="detail-kicker">HISTORY</p>'+
        '</div>'+
        '<h2>'+escapeHtml(vr.title||r.title)+'</h2>'+
        '<div class="detail-meta">'+
          '<span>約 '+vr.minutes+' 分</span>'+
          '<span>'+escapeHtml(vr.servings||'')+'</span>'+
          '<span>'+(rating?'★ '+rating+' / 10':'未評価')+'</span>'+
          '<span class="version-badge">ver.'+versionRow.version+'</span>'+
        '</div>'+
        '<p class="summary">'+escapeHtml(vr.summary||'')+'</p>'+
        '<button id="backToCurrentVersion" class="version-back-button" type="button">現在の ver.'+getCurrentVersion(r.id)+' に戻る</button>'+
      '</header>'+
      '<div class="recipe-body"><div class="recipe-materials">'+
        section('材料','<ul class="ingredients-list">'+(vr.ingredients||[]).map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>')+
      '</div><div class="recipe-method">'+
        section('下準備','<ol>'+(vr.prep||[]).map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ol>')+
        section('調理手順','<ol>'+(vr.steps||[]).map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ol>')+
        section('失敗しないポイント','<ul>'+(vr.points||[]).map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>')+
        section('追加すると美味しい食材・アレンジ','<ul>'+(vr.arrangements||[]).map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>')+
      '</div></div>'+
      '<div class="version-feedback">'+
        '<h3>このバージョン当時の評価・メモ</h3>'+
        '<p><strong>評価：</strong>'+(rating?'★ '+rating+' / 10':'未評価')+'</p>'+
        '<p><strong>メモ：</strong>'+(note?escapeHtml(note):'なし')+'</p>'+
      '</div>'+
    '</article>';

  els.content.querySelector('#backToCurrentVersion').addEventListener('click',()=>openRecipe(r));
  els.dialog.scrollTop=0;
}

function buildVersionHistory(r){
  const current=getCurrentVersion(r.id);
  const older=getVersions(r.id)
    .filter(v=>Number(v.version)<current)
    .sort((a,b)=>Number(b.version)-Number(a.version));

  if(!older.length) return '<p>過去のバージョンはありません。</p>';

  return '<div class="version-list">'+older.map(v=>{
    const d=v.recipe_data||{};
    const date=v.created_at ? new Date(v.created_at).toLocaleDateString('ja-JP') : '';
    const rating=Number(v.rating||0);
    return '<button type="button" class="version-list-item" data-version="'+v.version+'">'+
      '<span><strong>ver.'+v.version+'</strong>'+(date?' <small>'+escapeHtml(date)+'</small>':'')+'</span>'+
      '<span>'+(rating?'★ '+rating+' / 10':'未評価')+'</span>'+
      '<span class="version-list-summary">'+escapeHtml(d.summary||'')+'</span>'+
    '</button>';
  }).join('')+'</div>';
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
          '<span class="version-badge">ver.'+getCurrentVersion(r.id)+'</span>'+
        '</div>'+
        '<p class="summary">'+escapeHtml(r.summary)+'</p>'+
        (getVersions(r.id).filter(v=>Number(v.version)<getCurrentVersion(r.id)).length>0
          ? '<button id="versionHistoryButton" class="version-history-button" type="button">過去のバージョンを見る（'+getVersions(r.id).filter(v=>Number(v.version)<getCurrentVersion(r.id)).length+'）</button>'
          : '')+
        '<div id="versionHistoryPanel" class="version-history-panel" hidden></div>'+
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
        '<button class="save-note" id="saveNote" style="background:#f6f2ee;color:#7f4d38;border:none;border-radius:14px;padding:14px 22px;font-weight:800;-webkit-appearance:none;appearance:none;-webkit-text-fill-color:#7f4d38;">メモを保存</button>'+
        '<button class="delete-recipe-button" id="deleteRecipe" type="button" style="margin-top:10px;width:100%;background:#fff4f1;color:#9b3f2a;border:2px solid #9b3f2a;border-radius:14px;padding:14px 18px;font-weight:800;-webkit-appearance:none;appearance:none;-webkit-text-fill-color:#9b3f2a;">レシピを削除</button>'+
        (rating>0 && rating<=7
          ? '<button class="improve-recipe-button" id="improveRecipe" style="margin-top:12px;width:100%;background:#f6f2ee;color:#7f4d38;border:2px solid #7f4d38;border-radius:14px;padding:14px 18px;font-weight:800;-webkit-appearance:none;appearance:none;-webkit-text-fill-color:#7f4d38;">このレシピを改善する</button>'
          : '')+
        '<div id="improvementPanel" class="improvement-panel" hidden></div>'+
      '</div>'+
    '</article>';

  setupCookingModeControls();

  const versionHistoryButton=els.content.querySelector('#versionHistoryButton');
  if(versionHistoryButton){
    versionHistoryButton.addEventListener('click',()=>{
      const panel=els.content.querySelector('#versionHistoryPanel');
      panel.innerHTML=buildVersionHistory(r);
      panel.hidden=false;
      panel.querySelectorAll('[data-version]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const row=getVersionRow(r.id,Number(btn.dataset.version));
          if(row) renderHistoricalVersion(r,row);
        });
      });
      panel.scrollIntoView({behavior:'smooth',block:'nearest'});
    });
  }

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
  const deleteButton=els.content.querySelector('#deleteRecipe');
  if(deleteButton){
    deleteButton.addEventListener('click',async()=>{
      const ok=confirm('「'+r.title+'」をゴミ箱に移動しますか？');
      if(!ok) return;
      deleteButton.disabled=true;
      try{
        await setRecipeDeleted(r.id,true);
        els.dialog.close();
        render();
      }catch(err){
        console.error(err);
        alert('削除に失敗しました。\n'+err.message);
        deleteButton.disabled=false;
      }
    });
  }

  const improveButton=els.content.querySelector('#improveRecipe');
  if(improveButton){
    improveButton.addEventListener('click',()=>{
      const panel=els.content.querySelector('#improvementPanel');
      panel.innerHTML=buildImprovementSummary(r);
      panel.hidden=false;

      const copyButton=panel.querySelector('#copyImprovementPrompt');
      const promptArea=panel.querySelector('#improvementPrompt');
      copyButton.addEventListener('click',async()=>{
        try{
          await navigator.clipboard.writeText(promptArea.value);
          copyButton.textContent='コピーしました';
          setTimeout(()=>copyButton.textContent='ChatGPT用の改善依頼をコピー',1200);
        }catch(err){
          promptArea.focus();
          promptArea.select();
          copyButton.textContent='選択しました。コピーしてください';
        }
      });

      panel.scrollIntoView({behavior:'smooth',block:'start'});
    });
  }

  if(!els.dialog.open){els.dialog.showModal();els.dialog.scrollTop=0;}
}

function openTrash(){
  const deleted=recipes.filter(r=>isDeleted(r.id));

  els.content.innerHTML=
    '<article class="detail">'+
      '<header class="detail-header"><p class="detail-kicker">TRASH</p><h2>ゴミ箱</h2></header>'+
      '<div class="trash-list">'+
        (deleted.length
          ? deleted.map(r=>
              '<div class="trash-item">'+
                '<div><strong>'+escapeHtml(r.title)+'</strong><p>'+escapeHtml(r.summary||'')+'</p></div>'+
                '<button type="button" data-restore="'+escapeHtml(r.id)+'">復元</button>'+
              '</div>'
            ).join('')
          : '<p>削除したレシピはありません。</p>')+
      '</div>'+
    '</article>';

  els.content.querySelectorAll('[data-restore]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      btn.disabled=true;
      try{
        await setRecipeDeleted(btn.dataset.restore,false);
        openTrash();
        render();
      }catch(err){
        console.error(err);
        alert('復元に失敗しました。\n'+err.message);
        btn.disabled=false;
      }
    });
  });

  if(!els.dialog.open) els.dialog.showModal();
  els.dialog.scrollTop=0;
}

els.trashButton.addEventListener('click',openTrash);

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

  await migrateLocalDataIfNeeded();

  const versionsLoaded=await loadRecipeVersions();
  if(versionsLoaded){
    try{
      await bootstrapRecipeVersions();
      applyLatestVersions();
      renderLegend();
    }catch(error){
      console.error('Version bootstrap error:',error);
    }
  }

  render();
}

async function initialize(){
  try{
    const response=await fetch('recipes.json?v=20260927-5',{cache:'no-store'});
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