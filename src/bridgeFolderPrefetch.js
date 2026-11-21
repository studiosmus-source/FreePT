/**
 * Receiver-only progressive discovery for older TX catalogues which may put
 * files before directories across 100-entry pages.
 *
 * Never reorder remote offsets: each new page must be requested in sequence
 * so opaque file handles and pagination validation keep their normal guards.
 * Bounded automatic discovery prevents scanning huge directories forever.
 */
export function createBridgeFolderPrefetch({maxAutomaticPages=16}={}){
  if(!Number.isSafeInteger(maxAutomaticPages)||maxAutomaticPages<2||maxAutomaticPages>100)
    throw Error('bridge_folder_prefetch_invalid_limit');
  let currentHandle=null;
  let discovering=false;
  let pagesRead=0;
  return Object.freeze({
    record({handle,offset,page}={}){
      if(typeof handle!=='string'||!Number.isSafeInteger(offset)||offset<0||
         !page||!Array.isArray(page.entries)||!Number.isSafeInteger(page.nextOffset))
        throw Error('bridge_folder_prefetch_invalid_page');
      if(currentHandle!==handle||offset===0){
        currentHandle=handle;
        pagesRead=0;
        // The current TX sorts directories at the front. A first page made
        // solely of files signals a possible old file-first transmitter.
        discovering=offset===0&&page.nextOffset!==-1&&
          !page.entries.some(item=>item.directory===true);
      }
      pagesRead++;
      const pending=discovering&&page.nextOffset!==-1;
      return Object.freeze({
        pending,
        autoFetch:pending&&pagesRead<maxAutomaticPages,
        atLimit:pending&&pagesRead>=maxAutomaticPages,
        pagesRead
      });
    }
  });
}
