(function(){
  'use strict';
  const cards=[...document.querySelectorAll('.fit-pet-card')];
  const nameInput=document.getElementById('fit-pet-name');
  const continueBtn=document.getElementById('fit-continue');
  const introShell=document.querySelector('.fit-intro-shell');
  let selectedPet='dog';

  function update(){
    cards.forEach(card=>{
      const selected=card.dataset.pet===selectedPet;
      card.classList.toggle('is-selected',selected);
      card.setAttribute('aria-pressed',String(selected));
    });
    continueBtn.disabled=!selectedPet || !nameInput.value.trim();
  }

  cards.forEach(card=>card.addEventListener('click',()=>{
    selectedPet=card.dataset.pet;
    update();
  }));

  nameInput.addEventListener('input',update);
  nameInput.addEventListener('keydown',event=>{
    if(event.key==='Enter' && !continueBtn.disabled) continueBtn.click();
  });

  function startConversation(detail){
    const launcher=document.getElementById('cbfit-launcher');
    if(!launcher) return false;

    launcher.click();

    window.setTimeout(()=>{
      const input=document.getElementById('cbfit-textarea');
      const send=document.getElementById('cbfit-send');
      if(!input || !send) return;

      const petLabel=detail.petType==='cat'?'cat':'dog';
      input.value=`My ${petLabel}'s name is ${detail.petName}.`;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      send.click();

      if(introShell) introShell.setAttribute('aria-hidden','true');
    },80);

    return true;
  }

  continueBtn.addEventListener('click',()=>{
    if(continueBtn.disabled) return;

    const detail={
      petType:selectedPet,
      petName:nameInput.value.trim()
    };

    window.dispatchEvent(new CustomEvent('chatrbox:fit-intro-complete',{detail}));

    if(window.ChatrBoxFitAssessment && typeof window.ChatrBoxFitAssessment.start==='function'){
      window.ChatrBoxFitAssessment.start(detail);
      return;
    }

    if(!startConversation(detail)){
      console.warn('ChatrBox Fit Assessment engine is not available.');
    }
  });

  update();
})();
