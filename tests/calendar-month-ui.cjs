// The 日程 page is the month grid + selected-day list (the old 同期済み日程 table was removed).
// monthText(page): click every day that has events and collect the day lists' text (empty month → '').
async function monthText(page){
 const days=await page.$$eval('#ddCalendar [data-dd-day]:not([data-dd-count="0"])',b=>b.map(x=>x.dataset.ddDay));let text='';
 for(const day of days){await page.locator(`#ddCalendar [data-dd-day="${day}"]`).click();text+=await page.locator('#ddCalendar .dd-day-list').innerText()+'\n';}
 return text;
}
// dayItem(page,eventId): the event's row in the selected-day list (selects its day first).
async function dayItem(page,eventId){const day=await page.evaluate(id=>bizState.calendar.find(e=>e.id===id)?.date,eventId);if(day)await page.locator(`#ddCalendar [data-dd-day="${day}"]`).click();return page.locator(`#ddCalendar [data-dd-event="${eventId}"]`);}
module.exports={monthText,dayItem};
