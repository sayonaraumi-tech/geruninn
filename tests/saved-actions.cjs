// 保存帳票 on desktop (≥801px, 霧藍 design) keeps each row's actions in its 操作▾ menu; mobile cards show them inline.
// Opens the menus inside the given locator (a no-op on mobile) so the same role queries and clicks work at every width.
// Like the UI (one open menu at a time), menus outside the locator are closed first.
module.exports=async target=>{
 await target.page().evaluate(()=>document.querySelectorAll('details.action-menu[open]').forEach(m=>{m.open=false;}));
 await target.locator('details.action-menu').evaluateAll(menus=>menus.forEach(m=>{m.open=true;}));
};
