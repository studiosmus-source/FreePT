import {BRIDGE_FILE_LIMITS} from './bridgeFileProtocol.js';

/**
 * Exhaustive, receiver-side paging for one OPEN folder. Old TX builds can
 * return files before folders (or mix them on every page), so discovering any
 * folder in a page is NOT evidence that later pages contain no more folders.
 *
 * Continue sequentially until TX says nextOffset === -1. The only upper
 * bound is the existing wire/Android maximum of 10,000 entries, after which
 * completeness must be reported as unknown rather than claiming "all".
 * Does not recursively enumerate private/unauthorized paths.
 */
export function createBridgeFolderPrefetch({maxEntries=BRIDGE_FILE_LIMITS.maxTotalEntries}={}){
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||
     maxEntries>BRIDGE_FILE_LIMITS.maxTotalEntries)
    throw Error('bridge_folder_prefetch_invalid_limit');
  let currentHandle=null;
  let pagesRead=0;
  let itemsSeen=0;
  let expectedOffset=0;
  return Object.freeze({
    record({handle,offset,page}={}){
      if(typeof handle!=='string'||!handle||
         !Number.isSafeInteger(offset)||offset<0||
         !page||!Array.isArray(page.entries)||
         !Number.isSafeInteger(page.nextOffset)||
         page.nextOffset!==-1&&page.nextOffset<=offset)
        throw Error('bridge_folder_prefetch_invalid_page');
      if(currentHandle!==handle||offset===0){
        if(offset!==0)throw Error('bridge_folder_prefetch_missing_first_page');
        currentHandle=handle;
        pagesRead=0;
        itemsSeen=0;
        expectedOffset=0;
      }
      if(offset!==expectedOffset)
        throw Error('bridge_folder_prefetch_nonsequential_page');
      pagesRead++;
      itemsSeen+=page.entries.length;
      // A catalogue can be larger than the permitted protocol window.
      // Never treat hitting the window as a complete directory.
      const complete=page.nextOffset===-1;
      const atLimit=!complete&&(itemsSeen>=maxEntries||
        page.nextOffset>=BRIDGE_FILE_LIMITS.maxTotalEntries);
      expectedOffset=complete?-1:page.nextOffset;
      return Object.freeze({
        pending:!complete,
        autoFetch:!complete&&!atLimit,
        complete,
        atLimit,
        pagesRead,
        itemsSeen
      });
    }
  });
}
