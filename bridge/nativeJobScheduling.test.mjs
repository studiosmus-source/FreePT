import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const source=readFileSync(new URL('../android-bridge/BridgeTxJobService.java.template',import.meta.url),'utf8');
const control=readFileSync(new URL('../android-bridge/BridgeTxControlPlugin.java.template',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');

test('real Java scheduling handles returned rejection, exceptions, fallback and owner consent',()=>{
  // Compile the actual production scheduling methods against deterministic
  // Android API doubles. This is not an Android device or Doze simulation.
  const start=source.indexOf('    static void schedulePeriodic(');
  const end=source.indexOf('    @Override public boolean onStartJob(',start);
  assert.ok(start>=0&&end>start);
  const methods=source.slice(start,end);
  const harness=`
import java.util.*;
class Context {
  static final String JOB_SCHEDULER_SERVICE="jobs";
  JobScheduler scheduler=new JobScheduler();
  boolean paused=false;
  Object getSystemService(String name){return scheduler;}
  Context getSharedPreferences(String name,int mode){return this;}
  boolean getBoolean(String key,boolean fallback){return paused;}
}
class Build { static class VERSION { static int SDK_INT=35; } }
class ComponentName { ComponentName(Context c,Class<?> type){} }
class BridgeAllFilesCore { static boolean allowed=true; static boolean granted(){return allowed;} }
class BridgeDeviceSecretStore { static boolean ready=true; static boolean configured(Context c){return ready;} }
class BridgeBootstrapCore { static boolean ready=false; static boolean configured(Context c){return ready;} }
class JobInfo {
  static final int NETWORK_TYPE_ANY=1;
  int id; boolean expedited=false; long deadline=-1;
  static class Builder {
    JobInfo info=new JobInfo();
    Builder(int id,ComponentName name){info.id=id;}
    Builder setRequiredNetworkType(int type){return this;}
    Builder setPeriodic(long period,long flex){return this;}
    Builder setPersisted(boolean value){return this;}
    Builder setExpedited(boolean value){info.expedited=value;return this;}
    Builder setOverrideDeadline(long value){info.deadline=value;return this;}
    JobInfo build(){return info;}
  }
}
class JobScheduler {
  static final int RESULT_FAILURE=0,RESULT_SUCCESS=1;
  List<JobInfo> calls=new ArrayList<>();
  int[] responses={RESULT_SUCCESS};
  JobInfo getPendingJob(int id){return id==4753?new JobInfo():null;}
  int schedule(JobInfo info){
    calls.add(info);
    int result=responses[Math.min(calls.size()-1,responses.length-1)];
    if(result==-1)throw new IllegalStateException("quota");
    return result;
  }
}
class BridgeTxJobService {
  static final int JOB_ID=4752,PERIODIC_JOB_ID=4753;
  static final long PERIOD_MS=900000;
${methods}
}
public class SchedulingHarness {
  static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
  static Context fresh(int... responses){
    BridgeAllFilesCore.allowed=true;BridgeDeviceSecretStore.ready=true;
    BridgeBootstrapCore.ready=false;Build.VERSION.SDK_INT=35;
    Context c=new Context();c.scheduler.responses=responses;return c;
  }
  public static void main(String[] args){
    Context c=fresh(0,1);
    check(BridgeTxJobService.schedule(c,true),"returned expedited rejection must fall back");
    check(c.scheduler.calls.size()==2,"fallback must be attempted exactly once");
    check(c.scheduler.calls.get(0).expedited&&!c.scheduler.calls.get(1).expedited,
      "fallback must be an ordinary job");
    c=fresh(-1,1);
    check(BridgeTxJobService.schedule(c,true)&&c.scheduler.calls.size()==2,
      "thrown expedited rejection must fall back");
    c=fresh(1);
    check(BridgeTxJobService.schedule(c,true)&&c.scheduler.calls.size()==1,
      "accepted expedited job must not be duplicated");
    c=fresh(0,0);
    check(!BridgeTxJobService.schedule(c,true)&&c.scheduler.calls.size()==2,
      "periodic job must not mask both immediate rejections");
    c=fresh(-1,-1);
    check(!BridgeTxJobService.schedule(c,true),"exceptions must not report success");
    c=fresh(0,1);
    check(!BridgeTxJobService.schedule(c,false)&&c.scheduler.calls.size()==1,
      "ordinary rejection must not cause an unbounded retry");
    c=fresh(1);Build.VERSION.SDK_INT=30;
    check(BridgeTxJobService.schedule(c,true)&&!c.scheduler.calls.get(0).expedited
      &&c.scheduler.calls.get(0).deadline==0,"legacy Android keeps deadline wake");
    c=fresh(1);c.paused=true;
    check(!BridgeTxJobService.schedule(c,true)&&c.scheduler.calls.isEmpty(),"pause respected");
    c=fresh(1);BridgeAllFilesCore.allowed=false;
    check(!BridgeTxJobService.schedule(c,true)&&c.scheduler.calls.isEmpty(),"permission respected");
    c=fresh(1);BridgeDeviceSecretStore.ready=false;
    check(!BridgeTxJobService.schedule(c,true)&&c.scheduler.calls.isEmpty(),"identity required");
    BridgeBootstrapCore.ready=true;
    check(BridgeTxJobService.schedule(c,true),"synthetic onboarding still supported");
    c=fresh(1);c.scheduler=null;
    check(!BridgeTxJobService.schedule(c,true),"absent scheduler must fail closed");
    check(!BridgeTxJobService.schedule(null,true),"absent context must fail closed");
    System.out.println("13 scheduling scenarios passed");
  }
}
`;
  const dir=mkdtempSync(join(tmpdir(),'freept-scheduler-'));
  try{
    writeFileSync(join(dir,'SchedulingHarness.java'),harness);
    const compiled=spawnSync('javac',['SchedulingHarness.java'],{cwd:dir,encoding:'utf8',timeout:30000});
    assert.equal(compiled.status,0,compiled.error?.message||compiled.stderr);
    const result=spawnSync('java',['-cp',dir,'SchedulingHarness'],{encoding:'utf8',timeout:30000});
    assert.equal(result.status,0,result.error?.message||result.stderr);
    assert.match(result.stdout,/13 scheduling scenarios passed/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('native start reports actual immediate acceptance, not merely a periodic schedule',()=>{
  assert.match(control,/boolean requested=BridgeTxJobService\.schedule\(getContext\(\),true\)/);
  assert.match(control,/if\(!requested\)\{call\.reject\("bridge_tx_start_failed"\);return;\}/);
  assert.doesNotMatch(control,/out\.put\("requested",BridgeTxJobService\.isScheduled/);
});

test('failed native starts do not consume the two-minute app recovery cooldown',()=>{
  const start=main.indexOf('async function startProvisionedTxWhenAllowed(');
  const end=main.indexOf("\nconst el =",start);
  const recovery=main.slice(start,end);
  assert.ok(recovery.indexOf('await bridgeTxControl.start();')>=0);
  assert.ok(recovery.indexOf('lastNativeTxKick=Date.now();')>
    recovery.indexOf('await bridgeTxControl.start();'));
});
