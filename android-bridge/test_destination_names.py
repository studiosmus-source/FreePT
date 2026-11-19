"""Run the actual Java naming code on the JVM; this is not a SAF device test."""
from pathlib import Path
import subprocess
import tempfile
import unittest

class DestinationNamesTests(unittest.TestCase):
    def test_actual_java_naming_policy(self):
        source=Path(__file__).with_name('BridgeDestinationNames.java.template').read_text()
        harness='''package freepttest;
import java.util.Set;
public class Harness {
 public static void main(String[] args){
  assert BridgeDestinationNames.ownerLabel("  Cristina Rossi. ").equals("Cristina Rossi");
  assert BridgeDestinationNames.ownerLabel("..").equals("Persona");
  assert BridgeDestinationNames.ownerLabel(null).equals("Persona");
  assert BridgeDestinationNames.ownerLabel("CON").equals("_CON");
  assert BridgeDestinationNames.ownerLabel("NUL.txt").equals("_NUL.txt");
  assert BridgeDestinationNames.ownerLabel("a/b:c?d*e").equals("a_b_c_d_e");
  assert BridgeDestinationNames.ownerLabel("a\\\\b").equals("a_b");
  assert BridgeDestinationNames.ownerLabel("e\\u0301").equals("é");
  String emoji="👋".repeat(120),label=BridgeDestinationNames.ownerLabel(emoji);
  assert label.codePointCount(0,label.length())==80;
  assert BridgeDestinationNames.ownerName("Cristina",Set.of("cristina")).equals("Cristina (2)");
  assert BridgeDestinationNames.ownerName("é",Set.of("e\\u0301","É (2)")).equals("é (3)");
  assert BridgeDestinationNames.ownerName("Mario",Set.of()).equals("Mario");
 }
}'''
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/'BridgeDestinationNames.java').write_text(source.replace('__PACKAGE__','freepttest'))
            (root/'Harness.java').write_text(harness)
            subprocess.run(['java','-m','jdk.compiler/com.sun.tools.javac.Main','-encoding','UTF-8','-d',temp,str(root/'BridgeDestinationNames.java'),str(root/'Harness.java')],check=True,capture_output=True)
            subprocess.run(['java','-ea','-cp',temp,'freepttest.Harness'],check=True,capture_output=True)
