import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
import errno
import zipfile
from unittest.mock import patch
from compact_metro_sources import compact
from plan_tokyo_metro import write
from fetch_tokyo_metro import link_existing, old_receipts, BlobCache
from audit_metro_coverage import dictionaries


class VerifiedCacheTests(unittest.TestCase):
    def test_official_codelists_with_windows_zip_paths_keep_their_meaning(self):
        with tempfile.TemporaryDirectory(prefix='spinward-codelist-',dir='/tmp') as temporary:
            root=Path(temporary);(root/'receipts').mkdir();(root/'raw').mkdir()
            with zipfile.ZipFile(root/'raw/codes.zip','w') as archive:
                archive.writestr('codelists\\Common_landUseType.xml',
                    '<gml:Dictionary xmlns:gml="http://www.opengis.net/gml"><gml:Definition><gml:name>204</gml:name>'
                    '<gml:description>水面（河川水面）</gml:description></gml:Definition></gml:Dictionary>')
            write(root/'receipts/codes.json',dict(kind='codelist',status='acquired',cityCode='11238',path='raw/codes.zip'))
            self.assertEqual(dictionaries(root)[('11238','Common_landUseType.xml')]['204'],'水面（河川水面）')

    def test_appledouble_files_are_not_source_receipts(self):
        with tempfile.TemporaryDirectory(prefix='spinward-appledouble-',dir='/tmp') as temporary:
            root=Path(temporary);(root/'receipts').mkdir()
            (root/'receipts/._source.json').write_bytes(b'\x00\x05\x16\x07\xb0\x00')
            row=dict(url='https://example.test/source',status='acquired',sha256='abc',path='raw/source')
            write(root/'receipts/source.json',row)
            self.assertEqual(old_receipts(root),{row['url']:row})
            self.assertEqual(BlobCache(root).by_hash,{'abc':row})

    def test_external_volume_copy_preserves_source_and_validates_existing_bytes(self):
        with tempfile.TemporaryDirectory(prefix='spinward-volume-',dir='/tmp') as temporary:
            base=Path(temporary);source=base/'source';root=base/'target'
            (source/'raw').mkdir(parents=True);root.mkdir()
            data=b'public source bytes';original=source/'raw/source.gz';original.write_bytes(data)
            receipt=dict(url='https://example.test/source',path='raw/source.gz',bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
            with patch('plan_tokyo_metro.os.link',side_effect=OSError(errno.EXDEV,'different volumes')):
                result=link_existing(root,source,receipt)
            self.assertEqual((root/result['path']).read_bytes(),data)
            self.assertEqual(original.read_bytes(),data)
            self.assertFalse(os.path.samefile(original,root/result['path']))
            self.assertEqual(link_existing(root,source,receipt)['sha256'],receipt['sha256'])
            (root/result['path']).write_bytes(b'corrupt')
            with self.assertRaises(AssertionError):link_existing(root,source,receipt)

    def test_compaction_preserves_previous_source_and_all_receipts(self):
        with tempfile.TemporaryDirectory(prefix='spinward-metro-cache-',dir='/tmp') as temporary:
            parent=Path(temporary);root=parent/'new';(root/'raw').mkdir(parents=True);(root/'receipts').mkdir()
            data=b'original city geometry\n'*1000;original=parent/'previous.gml';original.write_bytes(data)
            os.link(original,root/'raw/retained.gml');packed=gzip.compress(data);(root/'raw/duplicate.gml.gz').write_bytes(packed)
            sha=hashlib.sha256(data).hexdigest()
            a=dict(status='acquired',url='https://example.test/a',path='raw/retained.gml',sha256=sha,bytes=len(data),reusedFrom=str(original))
            b=dict(status='acquired',url='https://example.test/b',path='raw/duplicate.gml.gz',sha256=sha,bytes=len(data),compression='gzip',storedBytes=len(packed),storedSha256=hashlib.sha256(packed).hexdigest())
            write(root/'receipts/a.json',a);write(root/'receipts/b.json',b)
            report=compact(root);self.assertEqual(report['rewrittenReceipts'],1)
            self.assertEqual(original.read_bytes(),data);self.assertTrue(os.path.samefile(original,root/'raw/retained.gml'))
            receipt=json.loads((root/'receipts/b.json').read_text());self.assertEqual(receipt['path'],'raw/retained.gml')
            self.assertEqual(receipt['url'],b['url']);self.assertNotIn('compression',receipt)
            self.assertFalse((root/'raw/duplicate.gml.gz').exists())
            self.assertEqual(compact(root)['unlinkedCachePaths'],0)

    def test_corrupt_duplicate_is_not_removed(self):
        with tempfile.TemporaryDirectory(prefix='spinward-metro-cache-',dir='/tmp') as temporary:
            root=Path(temporary);(root/'raw').mkdir();(root/'receipts').mkdir();data=b'original'
            for key in ['a','b']:
                (root/f'raw/{key}').write_bytes(data)
                write(root/f'receipts/{key}.json',dict(status='acquired',url=f'https://example.test/{key}',path=f'raw/{key}',sha256=hashlib.sha256(data).hexdigest(),bytes=len(data)))
            (root/'raw/b').write_bytes(b'corrupt!')
            with self.assertRaises(AssertionError):compact(root)
            self.assertTrue((root/'raw/a').exists());self.assertTrue((root/'raw/b').exists())


if __name__=='__main__':unittest.main()
