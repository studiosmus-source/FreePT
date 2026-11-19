"""Actual JVM signer + Node verifier. Does not certify Android Keystore hardware."""
from pathlib import Path
import subprocess
import tempfile
import json
import base64
import unittest

class BootstrapWireTests(unittest.TestCase):
    def test_native_wire_and_fixture_match_real_node_verifier(self):
        root=Path(__file__).resolve().parent.parent
        source=(root/'android-bridge/BridgeBootstrapProof.java.template').read_text().replace('__PACKAGE__','wiretest')
        harness='''package wiretest;
import java.security.*;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.nio.charset.StandardCharsets;
public class Harness {
 public static void main(String[] args)throws Exception{
  KeyPairGenerator gen=KeyPairGenerator.getInstance("EC");gen.initialize(new ECGenParameterSpec("secp256r1"));KeyPair key=gen.generateKeyPair();
  String id=java.util.UUID.randomUUID().toString(),nonce="a".repeat(32),payload="{\\"consent\\":true}";long time=System.currentTimeMillis();
  Signature sig=Signature.getInstance("SHA256withECDSA");sig.initSign(key.getPrivate());
  sig.update(BridgeBootstrapProof.message("start",id,time,nonce,payload).getBytes(StandardCharsets.UTF_8));
  System.out.println(Base64.getEncoder().encodeToString(key.getPublic().getEncoded()));
  System.out.println(id);System.out.println(time);System.out.println(nonce);
  System.out.println(Base64.getEncoder().encodeToString(payload.getBytes(StandardCharsets.UTF_8)));
  System.out.println(Base64.getEncoder().encodeToString(sig.sign()));
  byte[] hash=MessageDigest.getInstance("SHA-256").digest(BridgeBootstrapProof.fixture("a1".repeat(32)));
  System.out.println(java.util.HexFormat.of().formatHex(hash));
 }
}'''
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);(p/'BridgeBootstrapProof.java').write_text(source);(p/'Harness.java').write_text(harness)
            subprocess.run(['java','-m','jdk.compiler/com.sun.tools.javac.Main','-d',tmp,str(p/'BridgeBootstrapProof.java'),str(p/'Harness.java')],check=True,capture_output=True)
            result=subprocess.run(['java','-cp',tmp,'wiretest.Harness'],check=True,capture_output=True,text=True).stdout.splitlines()
            pub,uid,ts,nonce,payload,signature,digest=result
            request={'key':pub,'envelope':{'deviceId':uid,'timestamp':int(ts),'nonce':nonce,'payload':base64.b64decode(payload).decode(),'signature':signature},'digest':digest}
            js="""import assert from 'node:assert/strict';
import {verifyBootstrapEnvelope,bootstrapBytes,bootstrapHash} from './bridge/bootstrapProtocol.mjs';
const r=JSON.parse(process.argv[1]);assert.equal(verifyBootstrapEnvelope('start',r.envelope,r.key),true);
assert.equal(verifyBootstrapEnvelope('claim',r.envelope,r.key),false);
const all=Buffer.concat([bootstrapBytes('a1'.repeat(32),0,262144),bootstrapBytes('a1'.repeat(32),262144,37856)]);
assert.equal(bootstrapHash(all),r.digest);
"""
            subprocess.run(['node','--input-type=module','-e',js,json.dumps(request)],cwd=root,check=True,capture_output=True)
